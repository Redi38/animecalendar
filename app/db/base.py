"""Подключение к SQLite и общие помощники для запросов с IN (...)."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Iterable, Sequence
from typing import Any

import aiosqlite

from app.db.schema import SCHEMA, SCHEMA_VERSION

_IN_CHUNK = 500


def chunks(items: Sequence[Any], size: int = _IN_CHUNK) -> Iterable[Sequence[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def marks(n: int) -> str:
    return ",".join("?" * n)


class DbBase:
    """Соединение и общие помощники; таблицы разложены по миксинам в соседних модулях."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: aiosqlite.Connection | None = None
        self._write = asyncio.Lock()

    async def connect(self) -> None:
        if self._path != ":memory:":
            directory = os.path.dirname(os.path.abspath(self._path))
            os.makedirs(directory, exist_ok=True)
        conn = await aiosqlite.connect(self._path)
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA synchronous=NORMAL")
        await conn.executescript(SCHEMA)
        await conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        await conn.commit()
        self._conn = conn

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("База данных не подключена")
        return self._conn

    async def _select_in(
        self, sql: str, ids: Sequence[int], *, before: Sequence[Any] = (), after: Sequence[Any] = ()
    ) -> list[aiosqlite.Row]:
        """SELECT с условием IN ({marks}) пачками; before/after — параметры до и после списка ID."""
        out: list[aiosqlite.Row] = []
        for chunk in chunks(list(ids)):
            async with self.conn.execute(sql.format(marks=marks(len(chunk))), [*before, *chunk, *after]) as cur:
                out.extend(await cur.fetchall())
        return out

    async def _execute_in(self, sql: str, ids: Sequence[int], *, before: Sequence[Any] = ()) -> None:
        for chunk in chunks(list(ids)):
            await self.conn.execute(sql.format(marks=marks(len(chunk))), [*before, *chunk])
