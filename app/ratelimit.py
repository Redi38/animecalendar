"""Мини-ограничитель частоты запросов по IP (в памяти процесса).

Внешние API (AniList, Shikimori) делят одну квоту на всех посетителей, поэтому
дорогие эндпоинты не должны отдаваться на откуп одному клиенту.
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request

from app.config import settings


class SlidingWindow:
    def __init__(self, limit: int, window: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.limit = limit
        self.window = window
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = self._clock()
        if len(self._hits) > 5000:
            self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] < self.window}
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True


def client_ip(request: Request) -> str:
    if settings.TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def limiter(limit: int, window: float = 60.0) -> Callable[[Request], None]:
    """Зависимость FastAPI: не больше limit запросов за window секунд с одного IP."""
    bucket = SlidingWindow(limit, window)

    def check(request: Request) -> None:
        if not bucket.allow(client_ip(request)):
            raise HTTPException(429, "Слишком много запросов. Подождите минуту и попробуйте снова.")

    return check
