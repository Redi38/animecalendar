"""Клиент AniList GraphQL: сезонный каталог, выборка по ID, поиск.

Запросы лежат в anilist_queries, разбор ответов — в anilist_parse.

AniList даёт ~90 запросов в минуту (в плохие дни меньше), поэтому клиент
сам выдерживает паузу между запросами и уважает Retry-After при 429.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.providers.anilist_queries import (
    Q_BY_IDS,
    Q_BY_MAL_IDS,
    Q_BY_MAL_IDS_ADULT,
    Q_SEARCH,
    Q_SEARCH_ADULT,
    Q_SEASON,
    Q_STUDIO,
    Q_TBA,
)

logger = logging.getLogger(__name__)

PER_PAGE = 50
MIN_INTERVAL = 0.75  # секунд между запросами (~80 в минуту)
MAX_RETRY_AFTER = 20  # дольше ждать 429 не будем — отдаём ошибку


class AniListError(Exception):
    """AniList недоступен или отвечает ошибкой."""


class AniListClient:
    def __init__(
        self, url: str, user_agent: str, client: httpx.AsyncClient | None = None, *, allow_adult: bool = False
    ) -> None:
        self._allow_adult = allow_adult
        self._url = url
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=8.0),
            headers={"User-Agent": user_agent, "Accept": "application/json"},
        )
        self._pace = asyncio.Lock()
        self._last_request = 0.0

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _query(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(3):
            async with self._pace:
                wait = MIN_INTERVAL - (time.monotonic() - self._last_request)
                if wait > 0:
                    await asyncio.sleep(wait)
                self._last_request = time.monotonic()
            try:
                resp = await self._client.post(self._url, json={"query": query, "variables": variables})
            except httpx.HTTPError as e:
                last_error = e
                logger.warning("anilist: сетевая ошибка (попытка %d): %s", attempt + 1, e)
                await asyncio.sleep(1.5 * (attempt + 1))
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5") or 5)
                if retry_after > MAX_RETRY_AFTER:
                    raise AniListError("AniList просит подождать слишком долго")
                logger.warning("anilist: 429, ждём %d с", retry_after)
                await asyncio.sleep(retry_after + 0.5)
                last_error = AniListError("rate limited")
                continue
            if resp.status_code >= 500:
                last_error = AniListError(f"HTTP {resp.status_code}")
                await asyncio.sleep(1.5 * (attempt + 1))
                continue
            try:
                payload = resp.json()
            except ValueError as e:
                raise AniListError("AniList вернул не JSON") from e
            if resp.status_code >= 400 or payload.get("errors"):
                message = (payload.get("errors") or [{}])[0].get("message", f"HTTP {resp.status_code}")
                raise AniListError(message)
            return payload.get("data") or {}
        raise AniListError(str(last_error or "AniList недоступен"))

    async def season_page(self, season: str, year: int, page: int) -> tuple[list[dict], bool]:
        data = await self._query(Q_SEASON, {"season": season, "year": year, "page": page, "per": PER_PAGE})
        block = data.get("Page") or {}
        return block.get("media") or [], bool((block.get("pageInfo") or {}).get("hasNextPage"))

    async def tba_page(self, page: int) -> tuple[list[dict], bool]:
        data = await self._query(Q_TBA, {"page": page, "per": PER_PAGE})
        block = data.get("Page") or {}
        return block.get("media") or [], bool((block.get("pageInfo") or {}).get("hasNextPage"))

    async def studio_page(self, studio_id: int, page: int) -> tuple[str | None, list[dict], bool]:
        """Страница тайтлов студии: (название студии, узлы тайтлов, есть ли следующая страница)."""
        data = await self._query(Q_STUDIO, {"id": studio_id, "page": page, "per": PER_PAGE})
        studio = data.get("Studio") or {}
        media = studio.get("media") or {}
        return studio.get("name"), media.get("nodes") or [], bool((media.get("pageInfo") or {}).get("hasNextPage"))

    async def by_ids(self, ids: list[int]) -> list[dict]:
        out: list[dict] = []
        for i in range(0, len(ids), PER_PAGE):
            chunk = ids[i : i + PER_PAGE]
            data = await self._query(Q_BY_IDS, {"ids": chunk, "per": PER_PAGE})
            out.extend((data.get("Page") or {}).get("media") or [])
        return out

    async def by_mal_ids(self, ids: list[int]) -> list[dict]:
        out: list[dict] = []
        for i in range(0, len(ids), PER_PAGE):
            chunk = ids[i : i + PER_PAGE]
            data = await self._query(
                Q_BY_MAL_IDS_ADULT if self._allow_adult else Q_BY_MAL_IDS, {"ids": chunk, "per": PER_PAGE}
            )
            out.extend((data.get("Page") or {}).get("media") or [])
        return out

    async def search(self, q: str, limit: int = 12) -> list[dict]:
        data = await self._query(Q_SEARCH_ADULT if self._allow_adult else Q_SEARCH, {"q": q, "per": limit})
        return (data.get("Page") or {}).get("media") or []
