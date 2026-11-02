"""Связанные анонсы: обход связей AniList от просмотренных тайтлов с ограниченным бюджетом запросов."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from app.providers.anilist import AniListError
from app.services import dto
from app.services.ingest import Ingest
from app.services.related import CHAIN_TYPES, MAX_DEPTH, released_recently, walk

logger = logging.getLogger(__name__)

RELATIONS_TTL_ACTIVE = 12 * 3600  # анонсы и идущие тайтлы меняются часто
RELATIONS_TTL_DONE = 14 * 86400
FETCH_BUDGET = 150  # сколько тайтлов можно запросить у AniList за один вызов related()
ANNOUNCED = ("NOT_YET_RELEASED", "RELEASING")


class RelatedService:
    def __init__(self, ingest: Ingest) -> None:
        self.ingest = ingest
        self.db = ingest.db

    def _relations_stale(self, row: dict | None) -> bool:
        if row is None or row.get("relations_synced_at") is None:
            return True
        ttl = RELATIONS_TTL_ACTIVE if row.get("status") in ANNOUNCED else RELATIONS_TTL_DONE
        return self.ingest.now() - row["relations_synced_at"] > ttl

    async def related(self, watched_ids: list[int]) -> dict[str, Any]:
        """Анонсированные и выходящие тайтлы, связанные с просмотренными.

        Идём по связям AniList до MAX_DEPTH шагов; недостающие и устаревшие данные
        докачиваем пачками (не больше FETCH_BUDGET тайтлов за вызов). Если бюджета не хватило,
        в ответе incomplete=true: клиенту стоит повторить вызов, и обход продолжится с места остановки.
        """
        watched = list(dict.fromkeys(watched_ids))
        watched_set = set(watched)
        budget = FETCH_BUDGET
        degraded = False
        incomplete = False  # бюджет запросов кончился раньше, чем обошли все связи: нужен ещё вызов

        async def fetch(ids: list[int]) -> None:
            nonlocal budget, degraded, incomplete
            if len(ids) > budget:
                incomplete = True
            ids = ids[:budget]
            if not ids:
                return
            budget -= len(ids)
            try:
                await self.ingest.fetch_and_store(ids)
            except AniListError as e:
                degraded = True
                logger.warning("related: не удалось догрузить %d тайтлов: %s", len(ids), e)

        expanded: set[int] = set()
        frontier = set(watched)
        for _ in range(MAX_DEPTH):
            frontier -= expanded
            if not frontier:
                break
            rows = await self.db.get_titles(list(frontier))
            await fetch([i for i in frontier if self._relations_stale(rows.get(i))])
            expanded |= frontier
            edges = await self.db.relations_from(list(frontier))
            frontier = {t for src in frontier for t, rel in edges.get(src, []) if rel in CHAIN_TYPES}

        all_edges = await self.db.relations_from(list(expanded))
        hits = walk(watched, all_edges)

        rows = await self.db.get_titles(list(hits))
        # Статус и дата анонса должны быть свежими: подновляем устаревшие.
        refresh = [
            t
            for t, r in rows.items()
            if r["status"] in ANNOUNCED and self.ingest.now() - (r.get("synced_at") or 0) > RELATIONS_TTL_ACTIVE
        ]
        if refresh:
            await fetch(refresh)
            rows = await self.db.get_titles(list(hits))

        # В список попадает то, что ещё не вышло, выходит сейчас или вышло совсем недавно.
        today = datetime.fromtimestamp(self.ingest.now(), UTC).date()

        def shown(row: dict[str, Any]) -> bool:
            return row["status"] in ANNOUNCED or released_recently(row, today)

        # Русские названия нужны и анонсам, и просмотренным тайтлам, из которых они выросли («из «…»»).
        via_ids = {h.via for h in hits.values() if h.target in rows and shown(rows[h.target])}
        announced = [t for t, r in rows.items() if shown(r)]
        await self.ingest.enrich_ru([*announced, *via_ids], wait=6.0)
        rows = await self.db.get_titles(list(hits))
        sources = await self.db.get_titles(list(via_ids))

        now = self.ingest.now()
        items = []
        for target, hit in hits.items():
            row = rows.get(target)
            if row is None or not shown(row):
                continue
            item = dto.relation_entry(row, hit.relation, now=now)
            src = sources.get(hit.via)
            item["via"] = {"id": hit.via, "title": dto.display_title(src) if src else f"#{hit.via}"}
            item["also_via"] = len(hit.origins) - 1
            item["depth"] = hit.depth
            items.append(item)
        items.sort(key=lambda i: (dto.start_sort_key(i["start"]), -i["popularity"]))
        return {
            "items": items,
            "watched": len(watched_set),
            "degraded": degraded,
            "incomplete": incomplete,
            # все связанные тайтлы любого статуса: по ним в сезонной сетке ставится отметка «★»
            "linked": sorted(hits),
        }
