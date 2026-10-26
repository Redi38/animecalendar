"""Клиент Shikimori: русские названия, описания и поиск кириллицей.

Все методы «мягкие»: при любой ошибке сети или формата возвращают пустой
результат и пишут предупреждение в лог. Без Shikimori сайт продолжает
работать — просто показывает оригинальные названия.

ID тайтлов на Shikimori совпадают с ID на MyAnimeList (поле idMal в AniList).
Лимит API: 5 запросов в секунду и 90 в минуту.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.i18n import bbcode_text, plain_text

logger = logging.getLogger(__name__)

BATCH = 50  # максимум для limit в /api/animes
MIN_INTERVAL = 0.7  # ~85 запросов в минуту


class ShikimoriClient:
    def __init__(
        self,
        base_url: str,
        user_agent: str,
        *,
        enabled: bool = True,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self.enabled = enabled
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(12.0, connect=6.0),
            headers={"User-Agent": user_agent, "Accept": "application/json"},
            follow_redirects=True,
        )
        self._pace = asyncio.Lock()
        self._last_request = 0.0

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, params: dict[str, Any]) -> Any | None:
        if not self.enabled:
            return None
        async with self._pace:
            wait = MIN_INTERVAL - (time.monotonic() - self._last_request)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_request = time.monotonic()
        try:
            resp = await self._client.get(f"{self._base}{path}", params=params)
            if resp.status_code == 429:
                logger.warning("shikimori: 429, пропускаем запрос %s", path)
                return None
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.warning("shikimori: %s не удался: %s", path, e)
            return None

    async def russian_names(self, mal_ids: list[int]) -> tuple[dict[int, str], set[int]]:
        """Русские названия по MAL ID.

        Возвращает (названия, ответившие_id). В «ответивших» попадают все ID из
        успешных запросов — в том числе те, у кого русского названия нет: их
        не нужно спрашивать повторно. ID из упавших запросов не попадают никуда.
        """
        names: dict[int, str] = {}
        answered: set[int] = set()
        for i in range(0, len(mal_ids), BATCH):
            chunk = mal_ids[i : i + BATCH]
            data = await self._get(
                "/api/animes",
                {"ids": ",".join(str(x) for x in chunk), "limit": BATCH, "censored": "true"},
            )
            if not isinstance(data, list):
                continue
            answered.update(chunk)
            for item in data:
                try:
                    mal_id = int(item["id"])
                except (KeyError, TypeError, ValueError):
                    continue
                russian = (item.get("russian") or "").strip()
                if russian:
                    names[mal_id] = russian
        return names, answered

    async def search(self, q: str, limit: int = 12) -> list[dict[str, Any]]:
        """Поиск по названию (работает и с кириллицей). [{mal_id, russian, name}]."""
        data = await self._get(
            "/api/animes",
            {"search": q, "limit": min(limit, BATCH), "order": "popularity", "censored": "true"},
        )
        if not isinstance(data, list):
            return []
        out: list[dict[str, Any]] = []
        for item in data:
            try:
                out.append(
                    {
                        "mal_id": int(item["id"]),
                        "russian": (item.get("russian") or "").strip() or None,
                        "name": item.get("name"),
                    }
                )
            except (KeyError, TypeError, ValueError):
                continue
        return out

    async def description(self, mal_id: int) -> str | None:
        """Русское описание простым текстом.

        None — запрос не удался (стоит повторить позже); пустая строка — Shikimori
        ответил, но описания у тайтла нет.
        """
        data = await self._get(f"/api/animes/{mal_id}", {})
        if not isinstance(data, dict):
            return None
        return plain_text(data.get("description_html")) or bbcode_text(data.get("description")) or ""
