from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime

import httpx
import pytest

from app.config import Settings
from app.db import Database
from app.demo import DemoAniList, DemoShikimori
from app.providers.anilist import AniListError
from app.services.catalog import Catalog
from app.web import create_app

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC).timestamp()


class Clock:
    """Управляемое время: тесты двигают его вперёд, не засыпая."""

    def __init__(self, t: float = NOW) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class CountingAniList(DemoAniList):
    """Демо-AniList, который считает обращения и умеет «падать»."""

    def __init__(self, clock: Clock) -> None:
        super().__init__(clock)
        self.calls: list[tuple[str, tuple]] = []
        self.fail = False

    def _hit(self, name: str, *args: object) -> None:
        self.calls.append((name, args))
        if self.fail:
            raise AniListError("test: AniList недоступен")

    async def season_page(self, season, year, page):
        self._hit("season_page", season, year, page)
        return await super().season_page(season, year, page)

    async def by_ids(self, ids):
        self._hit("by_ids", tuple(ids))
        return await super().by_ids(ids)

    async def by_mal_ids(self, ids):
        self._hit("by_mal_ids", tuple(ids))
        return await super().by_mal_ids(ids)

    async def search(self, q, limit=12):
        self._hit("search", q)
        return await super().search(q, limit)

    def count(self, name: str) -> int:
        return sum(1 for n, _ in self.calls if n == name)


class CountingShikimori(DemoShikimori):
    def __init__(self, clock: Clock) -> None:
        super().__init__(clock)
        self.calls: list[str] = []
        self.enabled = True

    async def russian_names(self, mal_ids):
        self.calls.append("russian_names")
        return await super().russian_names(mal_ids)

    async def search(self, q, limit=12):
        self.calls.append("search")
        return await super().search(q, limit)

    async def description(self, mal_id):
        self.calls.append("description")
        return await super().description(mal_id)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
async def db() -> AsyncIterator[Database]:
    database = Database(":memory:")
    await database.connect()
    yield database
    await database.close()


@pytest.fixture
def anilist(clock: Clock) -> CountingAniList:
    return CountingAniList(clock)


@pytest.fixture
def shikimori(clock: Clock) -> CountingShikimori:
    return CountingShikimori(clock)


@pytest.fixture
async def catalog(
    db: Database, anilist: CountingAniList, shikimori: CountingShikimori, clock: Clock
) -> AsyncIterator[Catalog]:
    cat = Catalog(db, anilist, shikimori, clock=clock)  # type: ignore[arg-type]
    yield cat
    await cat.drain()


@pytest.fixture
async def client(catalog: Catalog) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(Settings(PREWARM=False, DEMO_MODE=True), catalog=catalog)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
