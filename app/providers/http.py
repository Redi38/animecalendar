"""Общие помощники HTTP-клиентов внешних API: пауза между запросами и «мягкий» GET."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class Pacer:
    """Выдерживает минимальную паузу между запросами, чтобы не упираться в лимиты API."""

    def __init__(self, interval: float) -> None:
        self._interval = interval
        self._lock = asyncio.Lock()
        self._last = 0.0

    async def wait(self) -> None:
        async with self._lock:
            pause = self._interval - (time.monotonic() - self._last)
            if pause > 0:
                await asyncio.sleep(pause)
            self._last = time.monotonic()


async def get_json_soft(
    client: httpx.AsyncClient, url: str, params: dict[str, Any] | None, *, label: str
) -> Any | None:
    """GET с разбором JSON. Любая ошибка сети, статуса или формата даёт None и предупреждение в логе
    (label — что именно запрашивали), чтобы сайт без внешнего API продолжал работать."""
    try:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("%s не удался: %s", label, e)
        return None
