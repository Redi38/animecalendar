"""Каталог: сезоны, карточки, поиск и связанные анонсы поверх SQLite-кэша.

Данные берутся из AniList (структура, даты, связи) и Shikimori (русские
названия и описания). Всё, что пришло, оседает в БД, поэтому повторные
запросы дешёвые, а сайт переживает кратковременные сбои внешних API.

Catalog — тонкий фасад: синхронизация сезонов живёт в SyncService, связанные анонсы
в RelatedService, франшизы в FranchiseService, студии в StudioService, карточки
в TitleService, поиск в SearchService, общая загрузка данных в Ingest.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable, Coroutine
from datetime import date
from typing import Any

from app.db import Database
from app.providers.ports import AniListPort, ShikimoriPort
from app.services.franchises import FranchiseService
from app.services.ingest import Ingest
from app.services.related_service import RelatedService
from app.services.search import SearchService
from app.services.studios import StudioService
from app.services.sync import SyncService
from app.services.titles import TitleService

logger = logging.getLogger(__name__)


class Catalog:
    def __init__(
        self,
        db: Database,
        anilist: AniListPort,
        shikimori: ShikimoriPort,
        *,
        clock: Callable[[], float] = time.time,
        allow_adult: bool = False,
    ) -> None:
        self.allow_adult = allow_adult
        self.db = db
        self.anilist = anilist
        self.shikimori = shikimori
        self._clock = clock
        self._ingest = Ingest(db, anilist, shikimori, clock=clock, allow_adult=allow_adult)
        self._sync = SyncService(self._ingest)
        self._related = RelatedService(self._ingest)
        self._franchises = FranchiseService(self._ingest)
        self._studios = StudioService(self._ingest)
        self._titles = TitleService(self._ingest)
        self._search = SearchService(self._ingest)

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

    # --- франшизы ----------------------------------------------------------------

    async def groups(self, ids: list[int]) -> list[dict[str, Any]]:
        return await self._franchises.watched(ids)

    async def search_groups(self, ids: list[int], *, deep: bool = False, limit: int = 5) -> list[dict[str, Any]]:
        return await self._franchises.for_search(ids, deep=deep, limit=limit)

    # --- студии ------------------------------------------------------------------

    async def studio(self, studio_id: int, page: int) -> dict[str, Any]:
        """Страница тайтлов студии. NotFound, если такой студии нет."""
        return await self._studios.view(studio_id, page)

    # --- карточки --------------------------------------------------------------

    async def titles_by_ids(self, ids: list[int]) -> tuple[list[dict], list[int]]:
        """Карточки по ID в том же порядке. Второй элемент — ID, которые найти не удалось."""
        return await self._titles.titles_by_ids(ids)

    async def detail(self, title_id: int) -> dict:
        return await self._titles.detail(title_id)

    async def watch_query(self, title_id: int) -> tuple[list[str], int | None, int | None]:
        """Данные для поиска страницы тайтла на сайте просмотра: (названия, MAL ID, год)."""
        return await self._titles.watch_query(title_id)

    # --- поиск -----------------------------------------------------------------

    async def search(self, query: str, *, deep: bool = False, limit: int = 30) -> list[dict]:
        return await self._search.search(query, deep=deep, limit=limit)
