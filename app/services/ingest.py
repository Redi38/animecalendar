"""Общий слой загрузки: AniList → SQLite, русские названия, фоновые задачи.

Им пользуются сервисы синхронизации, связанных анонсов и сам каталог.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from datetime import UTC, date, datetime
from typing import Any

from app.db import Database
from app.providers.anilist_parse import parse_media, parse_relations
from app.providers.ports import AniListPort, ShikimoriPort

logger = logging.getLogger(__name__)

RU_RECHECK = 7 * 86400  # как часто повторно искать русское название, которого нет


class Ingest:
    def __init__(
        self,
        db: Database,
        anilist: AniListPort,
        shikimori: ShikimoriPort,
        *,
        clock: Callable[[], float],
        allow_adult: bool,
    ) -> None:
        self.db = db
        self.anilist = anilist
        self.shikimori = shikimori
        self.allow_adult = allow_adult
        self._clock = clock
        self._tasks: set[asyncio.Task] = set()

    # --- служебное -----------------------------------------------------------

    def now(self) -> int:
        return int(self._clock())

    def today(self) -> date:
        return datetime.fromtimestamp(self._clock(), UTC).date()

    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._tasks.add(task)

        def _done(t: asyncio.Task) -> None:
            self._tasks.discard(t)
            if not t.cancelled() and t.exception() is not None:
                logger.warning("фоновая задача упала: %r", t.exception())

        task.add_done_callback(_done)
        return task

    async def drain(self) -> None:
        """Дождаться фоновых задач (для тестов и корректного выключения)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*list(self._tasks), return_exceptions=True)

    # --- загрузка из AniList ----------------------------------------------------

    async def store(self, media: list[dict]) -> set[int]:
        rows: list[dict] = []
        relations: dict[int, list[tuple[int, str]]] = {}
        nodes: list[dict] = []
        for m in media:
            if m.get("type") not in (None, "ANIME") or (m.get("isAdult") and not self.allow_adult):
                continue
            row = parse_media(m)
            edges, partial_nodes = parse_relations(m, allow_adult=self.allow_adult)
            rows.append(row)
            relations[row["id"]] = edges
            nodes.extend(partial_nodes)
        await self.db.upsert_full(rows, relations, nodes, self.now())
        return {r["id"] for r in rows}

    async def fetch_and_store(self, ids: list[int]) -> set[int]:
        media = await self.anilist.by_ids(ids)
        found = await self.store(media)
        # id, которых у AniList нет (не аниме, удалены), не стоит запрашивать при каждом обращении.
        await self.db.mark_relations_synced([i for i in ids if i not in found], self.now())
        return found

    async def enrich_ru(self, ids: list[int], wait: float | None = None) -> None:
        """Подтянуть русские названия; ждём не дольше wait секунд, остальное доедет в фоне."""
        if not self.shikimori.enabled or not ids:
            return
        pending = await self.db.ids_needing_ru(ids, self.now() - RU_RECHECK)
        if not pending:
            return
        mal_ids = sorted({mal for _, mal in pending})

        async def work() -> None:
            names, answered = await self.shikimori.russian_names(mal_ids)
            await self.db.apply_ru(names, answered, self.now())

        task = self.spawn(work())
        if wait:
            await asyncio.wait({task}, timeout=wait)
