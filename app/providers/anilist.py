"""Клиент AniList GraphQL: сезонный каталог, выборка по ID, поиск и связи между тайтлами.

AniList даёт ~90 запросов в минуту (в плохие дни меньше), поэтому клиент
сам выдерживает паузу между запросами и уважает Retry-After при 429.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.i18n import plain_text
from app.json_util import dumps

logger = logging.getLogger(__name__)

PER_PAGE = 50
MIN_INTERVAL = 0.75  # секунд между запросами (~80 в минуту)
MAX_RETRY_AFTER = 20  # дольше ждать 429 не будем — отдаём ошибку


class AniListError(Exception):
    """AniList недоступен или отвечает ошибкой."""


_MEDIA_FRAGMENT = """
fragment M on Media {
  id
  idMal
  type
  isAdult
  title { romaji english native }
  format
  status
  season
  seasonYear
  startDate { year month day }
  episodes
  duration
  source
  genres
  averageScore
  popularity
  coverImage { large color }
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { airingAt episode }
  description(asHtml: false)
  relations {
    edges {
      relationType(version: 2)
      node {
        id
        idMal
        type
        isAdult
        title { romaji english native }
        format
        status
        season
        seasonYear
        startDate { year month day }
        episodes
        averageScore
        popularity
        coverImage { large color }
      }
    }
  }
}
"""

Q_SEASON = (
    """
query ($season: MediaSeason, $year: Int, $page: Int, $per: Int) {
  Page(page: $page, perPage: $per) {
    pageInfo { hasNextPage }
    media(type: ANIME, season: $season, seasonYear: $year, isAdult: false, sort: [POPULARITY_DESC, ID]) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

# Анонсы без даты: сортировка по популярности, «без даты» отбирается в коде (is_tba).
Q_TBA = (
    """
query ($page: Int, $per: Int) {
  Page(page: $page, perPage: $per) {
    pageInfo { hasNextPage }
    media(type: ANIME, status: NOT_YET_RELEASED, isAdult: false, sort: [POPULARITY_DESC, ID]) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

Q_BY_IDS = (
    """
query ($ids: [Int], $per: Int) {
  Page(page: 1, perPage: $per) {
    media(type: ANIME, id_in: $ids) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

Q_BY_MAL_IDS = (
    """
query ($ids: [Int], $per: Int) {
  Page(page: 1, perPage: $per) {
    media(type: ANIME, idMal_in: $ids, isAdult: false) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

Q_SEARCH = (
    """
query ($q: String, $per: Int) {
  Page(page: 1, perPage: $per) {
    media(type: ANIME, search: $q, isAdult: false, sort: SEARCH_MATCH) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

# Те же запросы без фильтра isAdult (настройка ALLOW_ADULT). Календарь сезонов фильтр сохраняет.
Q_BY_MAL_IDS_ADULT = Q_BY_MAL_IDS.replace(", isAdult: false", "")
Q_SEARCH_ADULT = Q_SEARCH.replace(", isAdult: false", "")


# --- разбор ответа -----------------------------------------------------------


def _date(d: dict | None) -> tuple[int | None, int | None, int | None]:
    d = d or {}
    return d.get("year"), d.get("month"), d.get("day")


def _node_row(node: dict, *, partial: bool) -> dict[str, Any]:
    """Общие поля тайтла — одинаковые у полной записи и у узла связи."""
    title = node.get("title") or {}
    year, month, day = _date(node.get("startDate"))
    cover = node.get("coverImage") or {}
    return {
        "id": node["id"],
        "mal_id": node.get("idMal"),
        "title_romaji": title.get("romaji"),
        "title_english": title.get("english"),
        "title_native": title.get("native"),
        "format": node.get("format"),
        "status": node.get("status"),
        "season": node.get("season"),
        "season_year": node.get("seasonYear"),
        "start_year": year,
        "start_month": month,
        "start_day": day,
        "episodes": node.get("episodes"),
        "score": node.get("averageScore"),
        "popularity": node.get("popularity") or 0,
        "cover": cover.get("large"),
        "cover_color": cover.get("color"),
        "partial": 1 if partial else 0,
    }


def parse_media(media: dict) -> dict[str, Any]:
    """Полная запись тайтла из Media."""
    row = _node_row(media, partial=False)
    studios = [s["name"] for s in ((media.get("studios") or {}).get("nodes") or []) if s and s.get("name")]
    nxt = media.get("nextAiringEpisode") or {}
    row.update(
        {
            "duration": media.get("duration"),
            "source": media.get("source"),
            "genres": dumps(media.get("genres") or []),
            "studios": dumps(studios),
            "next_ep_at": nxt.get("airingAt"),
            "next_ep_number": nxt.get("episode"),
            "description": plain_text(media.get("description")),
        }
    )
    return row


def is_tba(media: dict) -> bool:
    """Анонс без даты: у тайтла нет ни сезона, ни года премьеры."""
    return not (media.get("seasonYear") or (media.get("startDate") or {}).get("year"))


def parse_relations(media: dict, *, allow_adult: bool = False) -> tuple[list[tuple[int, str]], list[dict[str, Any]]]:
    """Связи тайтла: [(target_id, relation_type)] и неполные записи целевых тайтлов.

    Берём только аниме (манга и ранобэ нам не нужны); взрослый контент — только при allow_adult.
    """
    edges: list[tuple[int, str]] = []
    nodes: list[dict[str, Any]] = []
    for edge in (media.get("relations") or {}).get("edges") or []:
        node = (edge or {}).get("node") or {}
        rel = (edge or {}).get("relationType")
        if not node.get("id") or not rel:
            continue
        if node.get("type") != "ANIME" or (node.get("isAdult") and not allow_adult):
            continue
        edges.append((node["id"], rel))
        nodes.append(_node_row(node, partial=True))
    return edges, nodes


# --- клиент ------------------------------------------------------------------


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
