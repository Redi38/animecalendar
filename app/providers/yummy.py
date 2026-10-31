"""Поиск точной страницы тайтла на сайте для кнопки «Смотреть онлайн».

Адрес страницы собирается из slug, который нельзя вычислить по названию («tokiyskie-mstiteli-4»,
«black-clover-2nd-season»). Поэтому спрашиваем поиск сайта и выбираем результат либо по ID
(MAL/Shikimori), либо по совпавшему названию и году. Нет совпадения — возвращаем None,
а интерфейс остаётся на обычной ссылке-поиске.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

HIT_TTL = 24 * 3600
MISS_TTL = 30 * 60  # «не нашли» помним недолго: сайт мог просто не успеть добавить тайтл
MAX_QUERIES = 3
SLUG_RE = re.compile(r"^[A-Za-z0-9._~-]{1,200}$")
ID_KEYS = ("shikimori", "myanimelist", "mal")


def norm(text: str | None) -> str:
    """Название для сравнения: без регистра, ё = е, только буквы и цифры."""
    s = (text or "").casefold().replace("ё", "е")
    return re.sub(r"[\W_]+", "", s)


def candidate_ids(cand: dict[str, Any]) -> set[int]:
    """ID тайтла в MAL/Shikimori, если сайт их отдаёт (remote_ids или плоские поля)."""
    found: set[int] = set()
    sources: list[dict[str, Any]] = [cand]
    remote = cand.get("remote_ids")
    if isinstance(remote, dict):
        sources.append(remote)
    for src in sources:
        for key, value in src.items():
            if any(part in key.lower() for part in ID_KEYS) and isinstance(value, (int, str)):
                try:
                    found.add(int(value))
                except ValueError:
                    pass
    return found


def candidate_names(cand: dict[str, Any]) -> set[str]:
    names = {norm(cand.get("title"))}
    for key in ("other_titles", "alt_titles", "title_en", "title_original"):
        value = cand.get(key)
        if isinstance(value, str):
            names.add(norm(value))
        elif isinstance(value, list):
            names.update(norm(v) for v in value if isinstance(v, str))
    names.discard("")
    return names


def candidate_year(cand: dict[str, Any]) -> int | None:
    year = cand.get("year")
    try:
        return int(year) if year is not None else None
    except (TypeError, ValueError):
        return None


def pick(cands: list[Any], titles: list[str], mal_id: int | None, year: int | None) -> str | None:
    """slug лучшего кандидата или None. Совпадение по ID сильнее совпадения названия и года."""
    wanted = {norm(t) for t in titles} - {""}
    best: tuple[int, str] | None = None
    for cand in cands:
        if not isinstance(cand, dict):
            continue
        slug = cand.get("anime_url") or cand.get("url") or cand.get("slug")
        if not isinstance(slug, str) or not SLUG_RE.match(slug):
            continue
        score = 0
        if mal_id and mal_id in candidate_ids(cand):
            score = 100
        elif wanted & candidate_names(cand):
            cy = candidate_year(cand)
            if year is None or cy is None:
                score = 30
            elif cy == year:
                score = 50
        if score and (best is None or score > best[0]):
            best = (score, slug)
    return best[1] if best else None


class YummyClient:
    def __init__(
        self,
        api_url: str,
        item_url: str,
        user_agent: str,
        *,
        token: str = "",
        enabled: bool = True,
        client: httpx.AsyncClient | None = None,
        clock: Any = time.time,
    ) -> None:
        self._api = api_url.rstrip("/")
        self._item_url = item_url
        self.enabled = bool(
            enabled and self._api and "{slug}" in item_url and item_url.startswith(("http://", "https://"))
        )
        headers = {"User-Agent": user_agent, "Accept": "application/json"}
        if token:
            headers["X-Application"] = token
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0), headers=headers, follow_redirects=True
        )
        self._cache: dict[tuple[Any, ...], tuple[float, str | None]] = {}
        self._clock = clock

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _search(self, query: str) -> list[Any] | None:
        try:
            resp = await self._client.get(f"{self._api}/search", params={"q": query, "limit": 24})
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.warning("watch: поиск «%s» не удался: %s", query, e)
            return None
        items = data.get("response") if isinstance(data, dict) else None
        return items if isinstance(items, list) else []

    async def find_page(self, titles: list[str], mal_id: int | None, year: int | None) -> str | None:
        if not self.enabled:
            return None
        queries = list(dict.fromkeys(t.strip() for t in titles if t and t.strip()))[:MAX_QUERIES]
        if not queries:
            return None
        key = (tuple(queries), mal_id, year)
        hit = self._cache.get(key)
        if hit and hit[0] > self._clock():
            return hit[1]

        failed = False
        slug: str | None = None
        for q in queries:
            cands = await self._search(q)
            if cands is None:
                failed = True
                continue
            slug = pick(cands, queries, mal_id, year)
            if slug:
                break
            logger.info("watch: по запросу «%s» нет подходящего результата (кандидатов: %d)", q, len(cands))
        url = self._item_url.replace("{slug}", quote(slug, safe="")) if slug else None
        if url or not failed:  # ошибки сети не кэшируем
            self._cache[key] = (self._clock() + (HIT_TTL if url else MISS_TTL), url)
        return url
