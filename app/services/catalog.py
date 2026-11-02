"""Каталог: сезоны, карточки, поиск и связанные анонсы поверх SQLite-кэша.

Данные берутся из AniList (структура, даты, связи) и Shikimori (русские
названия и описания). Всё, что пришло, оседает в БД, поэтому повторные
запросы дешёвые, а сайт переживает кратковременные сбои внешних API.

Catalog — фасад: синхронизация сезонов живёт в SyncService, связанные анонсы
в RelatedService, общая загрузка данных в Ingest.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable, Coroutine
from datetime import date
from typing import Any

from app.db import Database
from app.i18n import has_cyrillic, normalize
from app.providers.anilist import AniListError
from app.providers.ports import AniListPort, ShikimoriPort
from app.services import dto
from app.services.ingest import Ingest
from app.services.related_service import RelatedService
from app.services.sync import SyncService

logger = logging.getLogger(__name__)

DESC_RECHECK = 14 * 86400
SEARCH_CACHE_TTL = 600
SEARCH_CACHE_MAX = 500


class NotFound(Exception):
    pass


class Catalog:
    def __init__(
        self,
        db: Database,
        anilist: AniListPort,
        shikimori: ShikimoriPort,
        *,
        shikimori_base: str = "https://shikimori.io",
        clock: Callable[[], float] = time.time,
        allow_adult: bool = False,
    ) -> None:
        self.allow_adult = allow_adult
        self.db = db
        self.anilist = anilist
        self.shikimori = shikimori
        self.shikimori_base = shikimori_base
        self._clock = clock
        self._ingest = Ingest(db, anilist, shikimori, clock=clock, allow_adult=allow_adult)
        self._sync = SyncService(self._ingest)
        self._related = RelatedService(self._ingest)
        self._search_cache: dict[str, tuple[float, list[int]]] = {}

    # --- служебное -----------------------------------------------------------

    def now(self) -> int:
        return self._ingest.now()

    def today(self) -> date:
        return self._ingest.today()

    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
        return self._ingest.spawn(coro)

    async def drain(self) -> None:
        """Дождаться фоновых задач (для тестов и корректного выключения)."""
        await self._ingest.drain()

    async def close(self) -> None:
        await self._ingest.close()

    # --- сезоны и анонсы без даты (SyncService) ----------------------------------

    async def season(self, year: int, season: str) -> tuple[list[dict], int | None]:
        return await self._sync.season(year, season)

    async def tba(self) -> tuple[list[dict], int | None]:
        return await self._sync.tba()

    async def prewarm(self) -> None:
        """Текущий и следующий сезоны — к моменту первого визита."""
        await self._sync.prewarm()

    # --- связанные анонсы (RelatedService) ---------------------------------------

    async def related(self, watched_ids: list[int]) -> dict[str, Any]:
        return await self._related.related(watched_ids)

    # --- карточки --------------------------------------------------------------

    async def titles_by_ids(self, ids: list[int]) -> tuple[list[dict], list[int]]:
        """Карточки по ID в том же порядке. Второй элемент — ID, которые найти не удалось."""
        unique = list(dict.fromkeys(ids))
        rows = await self.db.get_titles(unique)
        missing = [i for i in unique if i not in rows]
        if missing:
            try:
                await self._ingest.fetch_and_store(missing)
            except AniListError as e:
                logger.warning("не удалось догрузить %d тайтлов: %s", len(missing), e)
            rows = await self.db.get_titles(unique)
        await self._ingest.enrich_ru(list(rows), wait=6.0)
        rows = await self.db.get_titles(list(rows))
        now = self.now()
        cards = [dto.card(rows[i], now=now) for i in unique if i in rows]
        return cards, [i for i in unique if i not in rows]

    async def detail(self, title_id: int) -> dict:
        rows = await self.db.get_titles([title_id], full=True)
        row = rows.get(title_id)
        if row is None or row["partial"]:
            try:
                await self._ingest.fetch_and_store([title_id])
            except AniListError:
                if row is None:
                    raise
            row = (await self.db.get_titles([title_id], full=True)).get(title_id)
        if row is None:
            raise NotFound(title_id)

        await self._ingest.enrich_ru([title_id], wait=4.0)
        row = (await self.db.get_titles([title_id], full=True))[title_id]

        if row.get("mal_id") and row.get("description_ru") is None and self.shikimori.enabled:
            checked = row.get("desc_ru_checked_at")
            if checked is None or self.now() - checked > DESC_RECHECK:
                text = await self.shikimori.description(row["mal_id"])
                if text is not None:  # None — запрос не удался, попробуем в следующий раз
                    await self.db.set_description_ru(title_id, text or None, self.now())
                    row["description_ru"] = text or None

        edges = (await self.db.relations_from([title_id])).get(title_id, [])
        targets = await self.db.get_titles([t for t, _ in edges])
        now = self.now()
        relations = [dto.relation_entry(targets[t], rel, now=now) for t, rel in edges if t in targets]
        order = {"PREQUEL": 0, "SEQUEL": 1, "PARENT": 2, "SIDE_STORY": 3, "SPIN_OFF": 4}
        relations.sort(key=lambda r: (order.get(r["relation"], 9), r["start"] or "9999"))
        return dto.detail(row, now=now, relations=relations, shikimori_base=self.shikimori_base)

    async def watch_query(self, title_id: int) -> tuple[list[str], int | None, int | None]:
        """Данные для поиска страницы тайтла на сайте просмотра: (названия, MAL ID, год)."""
        row = (await self.db.get_titles([title_id])).get(title_id)
        if row is None:
            raise NotFound(title_id)
        names = [row.get("title_ru"), row.get("title_english"), row.get("title_romaji")]
        return [n for n in names if n], row.get("mal_id"), row.get("start_year") or row.get("season_year")

    # --- поиск -----------------------------------------------------------------

    @staticmethod
    def _rank(rows: list[dict], query: str) -> list[dict]:
        q = normalize(query)

        def key(row: dict) -> tuple[int, int]:
            names = [normalize(row.get(k)) for k in ("title_ru", "title_english", "title_romaji", "title_native")]
            names = [n for n in names if n]
            if q in names:
                tier = 0
            elif any(n.startswith(q) for n in names):
                tier = 1
            elif any(f" {q}" in f" {n}" for n in names):
                tier = 2
            else:
                tier = 3
            return tier, -(row.get("popularity") or 0)

        return sorted(rows, key=key)

    async def search(self, query: str, *, deep: bool = False, limit: int = 30) -> list[dict]:
        q = query.strip()[:100]
        if len(normalize(q)) < 2:
            return []
        ranked = self._rank(await self.db.search_local(q, 80), q)
        # В быстром режиме (подсказки при наборе) ходим во внешние API, только если локально почти пусто.
        if deep or len(ranked) < 6:
            remote_ids = await self._remote_search(q)
            if remote_ids:
                have = {r["id"] for r in ranked}
                fresh = await self.db.get_titles([i for i in remote_ids if i not in have])
                ranked.extend(fresh[i] for i in remote_ids if i in fresh)
        top = ranked[:limit]
        # Русские названия найденных тайтлов: при полном поиске подождём немного, при подсказках — доедут в фоне.
        no_ru = [r["id"] for r in top if not r.get("title_ru")]
        if no_ru:
            await self._ingest.enrich_ru(no_ru, wait=2.5 if deep else None)
            fresh_rows = await self.db.get_titles([r["id"] for r in top])
            top = [fresh_rows.get(r["id"], r) for r in top]
        now = self.now()
        return [dto.card(r, now=now) for r in top]

    async def _remote_search(self, q: str) -> list[int]:
        key = normalize(q)
        cached = self._search_cache.get(key)
        if cached and self._clock() - cached[0] < SEARCH_CACHE_TTL:
            return cached[1]
        try:
            if has_cyrillic(q):
                hits = await self.shikimori.search(q, 12)
                if not hits:
                    ids: list[int] = []
                else:
                    media = await self.anilist.by_mal_ids([h["mal_id"] for h in hits])
                    found = await self._ingest.store(media)
                    names = {h["mal_id"]: h["russian"] for h in hits if h["russian"]}
                    await self.db.apply_ru(names, {h["mal_id"] for h in hits}, self.now())
                    by_mal = {m["idMal"]: m["id"] for m in media if m.get("idMal") and m["id"] in found}
                    ids = [by_mal[h["mal_id"]] for h in hits if h["mal_id"] in by_mal]
            else:
                media = await self.anilist.search(q, 12)
                found = await self._ingest.store(media)
                ids = [m["id"] for m in media if m["id"] in found]
                await self._ingest.enrich_ru(ids, wait=3.0)
        except AniListError as e:
            logger.warning("внешний поиск %r не удался: %s", q, e)
            return []
        if len(self._search_cache) >= SEARCH_CACHE_MAX:
            self._search_cache.clear()
        self._search_cache[key] = (self._clock(), ids)
        return ids
