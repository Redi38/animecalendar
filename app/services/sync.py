"""Синхронизация сезонов и анонсов без даты: AniList → SQLite, с обновлением протухших данных в фоне."""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from collections.abc import Callable, Coroutine
from typing import Any

from app.providers.anilist import AniListError
from app.providers.anilist_parse import is_tba
from app.seasons import season_of, shift, ttl_seconds
from app.services.ingest import Ingest

logger = logging.getLogger(__name__)

MAX_PAGES = 12  # 600 тайтлов на сезон — с запасом
TBA_KEY = "tba"
TBA_TTL = 6 * 3600
MAX_TBA_PAGES = 10  # самые популярные 500 анонсов; без даты из них остаётся лишь часть
TBA_WINDOW = 1800  # запись считается свежей, если её сохранила выборка не раньше, чем за столько секунд

Refresh = Callable[[], Coroutine[Any, Any, set[int]]]  # загрузить и сохранить; вернуть ID сохранённых тайтлов


class SyncService:
    def __init__(self, ingest: Ingest) -> None:
        self.ingest = ingest
        self.db = ingest.db
        self.anilist = ingest.anilist
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._refreshing: set[str] = set()

    async def _ensure_fresh(self, key: str, ttl: int, label: str, refresh: Refresh) -> None:
        """Первый раз ждём загрузку, протухшее отдаём как есть и обновляем в фоне (stale-while-revalidate)."""
        synced = await self.db.season_synced_at(key)
        if synced is None:
            await self._refresh(key, ttl, label, refresh)
        elif self.ingest.now() - synced > ttl and key not in self._refreshing:
            self._refreshing.add(key)
            self.ingest.spawn(self._refresh_quietly(key, ttl, label, refresh))

    async def _refresh_quietly(self, key: str, ttl: int, label: str, refresh: Refresh) -> None:
        try:
            await self._refresh(key, ttl, label, refresh)
        except AniListError as e:
            logger.warning("не удалось обновить %s: %s", label, e)
        finally:
            self._refreshing.discard(key)

    async def _refresh(self, key: str, ttl: int, label: str, refresh: Refresh) -> None:
        async with self._locks[key]:
            synced = await self.db.season_synced_at(key)
            if synced is not None and self.ingest.now() - synced <= ttl:
                return  # пока ждали замок, другой запрос уже обновил
            ids = await refresh()
            await self.db.mark_season(key, self.ingest.now(), len(ids))
            logger.info("%s обновлён: %d тайтлов", label, len(ids))
            await self.ingest.enrich_ru(sorted(ids), wait=8.0)

    @staticmethod
    async def _collect(
        fetch_page: Callable[[int], Coroutine[Any, Any, tuple[list[dict], bool]]], max_pages: int
    ) -> tuple[list[dict], bool]:
        """Страницы AniList подряд. Второй элемент — выбрано ли всё (иначе упёрлись в лимит страниц)."""
        media: list[dict] = []
        page, has_next = 1, True
        while has_next and page <= max_pages:
            chunk, has_next = await fetch_page(page)
            media.extend(chunk)
            page += 1
        return media, not has_next

    # --- сезоны ----------------------------------------------------------------

    async def season(self, year: int, season: str) -> tuple[list[dict], int | None]:
        key = f"{year}-{season}"
        ttl = ttl_seconds(season, year, self.ingest.today())
        await self._ensure_fresh(key, ttl, f"сезон {key}", lambda: self._fetch_season(year, season))
        rows = await self.db.season_titles(season, year)
        return rows, await self.db.season_synced_at(key)

    async def _fetch_season(self, year: int, season: str) -> set[int]:
        media, complete = await self._collect(lambda page: self.anilist.season_page(season, year, page), MAX_PAGES)
        ids = await self.ingest.store(media)
        if complete:  # иначе часть тайтлов сезона просто не дошла — выпускать из сезона рано
            dropped = await self.db.release_from_season(season, year, ids)
            if dropped:
                logger.info("сезон %s-%s: убрано тайтлов, переехавших в другой сезон: %d", year, season, dropped)
        return ids

    # --- анонсы без даты --------------------------------------------------------

    async def tba(self) -> tuple[list[dict], int | None]:
        await self._ensure_fresh(TBA_KEY, TBA_TTL, "анонсы без даты", self._fetch_tba)
        synced = await self.db.season_synced_at(TBA_KEY)
        return await self.db.tba_titles((synced or 0) - TBA_WINDOW), synced

    async def _fetch_tba(self) -> set[int]:
        media, _ = await self._collect(self.anilist.tba_page, MAX_TBA_PAGES)
        return await self.ingest.store([m for m in media if is_tba(m)])

    async def prewarm(self) -> None:
        """Текущий и следующий сезоны — к моменту первого визита."""
        season, year = season_of(self.ingest.today())
        nxt_season, nxt_year = shift(season, year, 1)
        for y, s in ((year, season), (nxt_year, nxt_season)):
            try:
                await self.season(y, s)
            except AniListError as e:
                logger.warning("прогрев сезона %s-%s не удался: %s", y, s, e)
        try:
            await self.tba()
        except AniListError as e:
            logger.warning("прогрев анонсов без даты не удался: %s", e)
