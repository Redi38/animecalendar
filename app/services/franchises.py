"""Франшизы для списка просмотренного и для поиска: группы тайтлов с названием, обложкой и участниками."""

from __future__ import annotations

import logging
from typing import Any

from app.providers.anilist import AniListError
from app.services import dto
from app.services.groups import MAX_GROUP_SIZE, Group, GroupService
from app.services.ingest import Ingest

logger = logging.getLogger(__name__)


class FranchiseService:
    def __init__(self, ingest: Ingest) -> None:
        self.ingest = ingest
        self.db = ingest.db
        self._groups = GroupService(ingest)

    async def _group_heads(self, groups: list[Group], *, wait: float | None) -> dict[int, dict]:
        """Записи главных тайтлов групп (с русскими названиями) — по ним группа называется и получает обложку."""
        roots = [g.root for g in groups]
        await self.ingest.enrich_ru(roots, wait=wait)
        return await self.db.get_titles(roots)

    @staticmethod
    def _group_head(group: Group, head: dict | None) -> dict[str, Any]:
        row = head or {"id": group.root}
        return {
            "id": group.root,
            "title": dto.display_title(row),
            "cover": row.get("cover"),
            "color": row.get("cover_color"),
            "total": len(group.members),
        }

    async def watched(self, ids: list[int]) -> list[dict[str, Any]]:
        """Группы-франшизы для списка просмотренного: только те, где в списке два тайтла и больше.

        seeds — ID из запроса, входящие в группу; total — размер всей франшизы по известным связям.
        """
        unique = list(dict.fromkeys(ids))
        built = [g for g in await self._groups.build(unique, fetch_budget=100) if len(g.seeds) > 1]
        heads = await self._group_heads(built, wait=3.0)
        return [{**self._group_head(g, heads.get(g.root)), "seeds": g.seeds} for g in built]

    async def for_search(self, ids: list[int], *, deep: bool = False, limit: int = 5) -> list[dict[str, Any]]:
        """Франшизы найденных тайтлов (только из двух и более тайтлов), по порядку лучшего совпадения.

        Участники группы отдаются карточками целиком: часть из них в поиск не попала, но в группе их видно.
        matched — ID, которые нашёл сам поиск.
        """
        try:
            built = [g for g in await self._groups.build(ids, fetch_budget=30 if deep else 0) if len(g.members) > 1]
        except AniListError as e:
            logger.warning("группы для поиска не собраны: %s", e)
            return []
        built = built[:limit]
        if not built:
            return []
        heads = await self._group_heads(built, wait=2.5 if deep else None)
        member_ids = [m for g in built for m in g.members[:MAX_GROUP_SIZE]]
        rows = await self.db.get_titles(member_ids)
        no_ru = [m for m, r in rows.items() if not r.get("title_ru")]
        if no_ru:
            await self.ingest.enrich_ru(no_ru, wait=2.5 if deep else None)
            rows = await self.db.get_titles(member_ids)
        now = self.ingest.now()
        return [
            {
                **self._group_head(g, heads.get(g.root)),
                "matched": g.seeds,
                "members": [dto.card(rows[m], now=now) for m in g.members[:MAX_GROUP_SIZE] if m in rows],
            }
            for g in built
        ]
