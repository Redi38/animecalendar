"""SQLite-кэш каталога (aiosqlite).

Хранит тайтлы целиком (полные записи из сезонных выборок) и «неполные» —
узлы связей, у которых известны только название, статус и дата. Неполные
записи достаточно, чтобы показать карточку анонса, а полные подтягиваются
по требованию.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Iterable, Sequence
from typing import Any

import aiosqlite

from app.i18n import normalize, search_stem

SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS titles (
    id INTEGER PRIMARY KEY,
    mal_id INTEGER,
    title_romaji TEXT,
    title_english TEXT,
    title_native TEXT,
    title_ru TEXT,
    search_text TEXT NOT NULL DEFAULT '',
    format TEXT,
    status TEXT,
    season TEXT,
    season_year INTEGER,
    start_year INTEGER,
    start_month INTEGER,
    start_day INTEGER,
    episodes INTEGER,
    duration INTEGER,
    source TEXT,
    genres TEXT,
    studios TEXT,
    next_ep_at INTEGER,
    next_ep_number INTEGER,
    score INTEGER,
    popularity INTEGER NOT NULL DEFAULT 0,
    cover TEXT,
    cover_color TEXT,
    description TEXT,
    description_ru TEXT,
    desc_ru_checked_at INTEGER,
    ru_checked_at INTEGER,
    relations_synced_at INTEGER,
    synced_at INTEGER NOT NULL DEFAULT 0,
    partial INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_titles_season ON titles (season_year, season);
CREATE INDEX IF NOT EXISTS idx_titles_mal ON titles (mal_id);

CREATE TABLE IF NOT EXISTS relations (
    source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations (target_id);

-- Страницы списка тайтлов студии (порядок AniList: от новых к старым). Сами тайтлы лежат в titles.
CREATE TABLE IF NOT EXISTS studio_pages (
    studio_id INTEGER NOT NULL,
    page INTEGER NOT NULL,
    name TEXT NOT NULL,
    ids TEXT NOT NULL,
    has_next INTEGER NOT NULL,
    synced_at INTEGER NOT NULL,
    PRIMARY KEY (studio_id, page)
);

CREATE TABLE IF NOT EXISTS season_sync (
    key TEXT PRIMARY KEY,
    synced_at INTEGER NOT NULL,
    total INTEGER NOT NULL
);
"""

# Поля, общие для полной и неполной записи.
_BASIC = (
    "mal_id", "title_romaji", "title_english", "title_native", "format", "status", "season",
    "season_year", "start_year", "start_month", "start_day", "episodes", "score", "popularity",
    "cover", "cover_color",
)  # fmt: skip
# Поля, которые приходят только вместе с полной записью.
_FULL_ONLY = ("duration", "source", "genres", "studios", "next_ep_at", "next_ep_number", "description")

# Тяжёлые поля (описания, поисковый индекс) нужны только карточке тайтла и самому поиску:
# в списках и сетках их не читаем.
_HEAVY = frozenset({"description", "description_ru", "search_text"})
_ALL_COLUMNS = (
    "id", *_BASIC, "title_ru", "search_text", *_FULL_ONLY, "description_ru",
    "desc_ru_checked_at", "ru_checked_at", "relations_synced_at", "synced_at", "partial",
)  # fmt: skip
_LIGHT = ", ".join(c for c in dict.fromkeys(_ALL_COLUMNS) if c not in _HEAVY)

_IN_CHUNK = 500


def _chunks(items: Sequence[Any], size: int = _IN_CHUNK) -> Iterable[Sequence[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _marks(n: int) -> str:
    return ",".join("?" * n)


def build_search_text(row: dict[str, Any]) -> str:
    parts = (row.get("title_ru"), row.get("title_english"), row.get("title_romaji"), row.get("title_native"))
    return "\n".join(n for n in (normalize(p) for p in parts) if n)


class Database:
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
        await conn.executescript(_SCHEMA)
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
        for chunk in _chunks(list(ids)):
            async with self.conn.execute(sql.format(marks=_marks(len(chunk))), [*before, *chunk, *after]) as cur:
                out.extend(await cur.fetchall())
        return out

    async def _execute_in(self, sql: str, ids: Sequence[int], *, before: Sequence[Any] = ()) -> None:
        for chunk in _chunks(list(ids)):
            await self.conn.execute(sql.format(marks=_marks(len(chunk))), [*before, *chunk])

    # --- чтение ---------------------------------------------------------------

    async def get_titles(self, ids: Sequence[int], *, full: bool = False) -> dict[int, dict[str, Any]]:
        """Записи по ID. full=True добавляет описания и поисковый индекс (нужны только карточке тайтла)."""
        cols = "*" if full else _LIGHT
        rows = await self._select_in(f"SELECT {cols} FROM titles WHERE id IN ({{marks}})", ids)
        return {r["id"]: dict(r) for r in rows}

    async def season_titles(self, season: str, year: int) -> list[dict[str, Any]]:
        async with self.conn.execute(
            f"SELECT {_LIGHT} FROM titles WHERE season = ? AND season_year = ? ORDER BY popularity DESC, id",
            (season, year),
        ) as cur:
            return [dict(r) async for r in cur]

    async def tba_titles(self, since: int) -> list[dict[str, Any]]:
        """Анонсы без сезона и даты, подтверждённые свежей выборкой (synced_at >= since)."""
        async with self.conn.execute(
            f"SELECT {_LIGHT} FROM titles WHERE status = 'NOT_YET_RELEASED' AND season_year IS NULL "
            "AND start_year IS NULL AND partial = 0 AND synced_at >= ? ORDER BY popularity DESC, id",
            (since,),
        ) as cur:
            return [dict(r) async for r in cur]

    async def search_local(self, query: str, limit: int = 60) -> list[dict[str, Any]]:
        """Все слова запроса должны встретиться в названиях (на любом языке)."""
        tokens = [search_stem(t) for t in normalize(query).split()]
        if not tokens:
            return []
        where = " AND ".join("instr(search_text, ?) > 0" for _ in tokens)
        async with self.conn.execute(
            f"SELECT {_LIGHT} FROM titles WHERE {where} ORDER BY popularity DESC LIMIT ?",
            [*tokens, limit],
        ) as cur:
            return [dict(r) async for r in cur]

    async def relations_from(self, source_ids: Sequence[int]) -> dict[int, list[tuple[int, str]]]:
        out: dict[int, list[tuple[int, str]]] = {}
        rows = await self._select_in(
            "SELECT source_id, target_id, relation_type FROM relations WHERE source_id IN ({marks})", source_ids
        )
        for r in rows:
            out.setdefault(r["source_id"], []).append((r["target_id"], r["relation_type"]))
        return out

    async def group_edges(self, ids: Sequence[int], types: Iterable[str]) -> list[tuple[int, int]]:
        """Связи заданных типов, у которых один из концов в ids (в любую сторону): [(source_id, target_id)]."""
        kinds = sorted(types)
        out: set[tuple[int, int]] = set()
        for column in ("source_id", "target_id"):
            rows = await self._select_in(
                f"SELECT source_id, target_id FROM relations WHERE {column} IN ({{marks}}) "
                f"AND relation_type IN ({_marks(len(kinds))})",
                ids,
                after=kinds,
            )
            out.update((r["source_id"], r["target_id"]) for r in rows)
        return sorted(out)

    async def season_synced_at(self, key: str) -> int | None:
        async with self.conn.execute("SELECT synced_at FROM season_sync WHERE key = ?", (key,)) as cur:
            row = await cur.fetchone()
        return row["synced_at"] if row else None

    async def studio_page(self, studio_id: int, page: int) -> dict[str, Any] | None:
        """Сохранённая страница студии: {name, ids, has_next, synced_at} или None."""
        async with self.conn.execute(
            "SELECT name, ids, has_next, synced_at FROM studio_pages WHERE studio_id = ? AND page = ?",
            (studio_id, page),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        return {
            "name": row["name"],
            "ids": [i for i in json.loads(row["ids"]) if isinstance(i, int)],
            "has_next": bool(row["has_next"]),
            "synced_at": row["synced_at"],
        }

    async def ids_needing_ru(self, ids: Sequence[int], checked_before: int) -> list[tuple[int, int]]:
        """(id, mal_id) из ids, для которых русское название ещё не искали или давно не проверяли."""
        rows = await self._select_in(
            "SELECT id, mal_id FROM titles WHERE id IN ({marks}) AND mal_id IS NOT NULL AND title_ru IS NULL "
            "AND (ru_checked_at IS NULL OR ru_checked_at < ?)",
            ids,
            after=[checked_before],
        )
        return [(r["id"], r["mal_id"]) for r in rows]

    # --- запись ---------------------------------------------------------------

    async def _existing_ru(self, ids: Sequence[int]) -> dict[int, str | None]:
        rows = await self._select_in("SELECT id, title_ru FROM titles WHERE id IN ({marks})", ids)
        return {r["id"]: r["title_ru"] for r in rows}

    @staticmethod
    def _upsert_sql(cols: Sequence[str], *, partial: bool) -> str:
        """INSERT ... ON CONFLICT для полной (partial=False) или неполной записи.

        Неполная запись никогда не затирает полную: обновляется только то, что уже неполное.
        """
        values = ", ".join(f":{c}" for c in cols)
        updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c != "id")
        sql = (
            f"INSERT INTO titles ({', '.join(cols)}, search_text, synced_at, partial) "
            f"VALUES ({values}, :search_text, :synced_at, {int(partial)}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}, search_text = excluded.search_text, "
            "synced_at = excluded.synced_at"
        )
        return sql + (" WHERE titles.partial = 1" if partial else ", partial = 0")

    async def _upsert_rows(
        self, rows: Sequence[dict[str, Any]], cols: Sequence[str], *, partial: bool, now: int
    ) -> None:
        """Записать строки одним executemany; сохраняет уже найденные русские названия в search_text."""
        if not rows:
            return
        ru = await self._existing_ru([r["id"] for r in rows])
        params = []
        for row in rows:
            merged = {c: row.get(c) for c in cols}
            merged["popularity"] = merged["popularity"] or 0
            merged["search_text"] = build_search_text({**row, "title_ru": ru.get(row["id"])})
            merged["synced_at"] = now
            params.append(merged)
        await self.conn.executemany(self._upsert_sql(cols, partial=partial), params)

    async def upsert_full(
        self,
        rows: list[dict[str, Any]],
        relations: dict[int, list[tuple[int, str]]],
        partial_nodes: list[dict[str, Any]],
        now: int,
    ) -> None:
        """Полные записи + их связи + неполные записи связанных тайтлов — одной транзакцией."""
        async with self._write:
            await self._upsert_rows(rows, ["id", *_BASIC, *_FULL_ONLY], partial=False, now=now)

            for source_id, edges in relations.items():
                await self.conn.execute("DELETE FROM relations WHERE source_id = ?", (source_id,))
                await self.conn.executemany(
                    "INSERT OR IGNORE INTO relations (source_id, target_id, relation_type) VALUES (?, ?, ?)",
                    [(source_id, target, rel) for target, rel in edges],
                )
                await self.conn.execute("UPDATE titles SET relations_synced_at = ? WHERE id = ?", (now, source_id))

            await self._upsert_partial_locked(partial_nodes, now)
            await self.conn.commit()

    async def _upsert_partial_locked(self, rows: list[dict[str, Any]], now: int) -> None:
        unique = {r["id"]: r for r in rows}  # узел может встретиться у нескольких тайтлов
        await self._upsert_rows(list(unique.values()), ["id", *_BASIC], partial=True, now=now)

    async def save_studio_page(
        self, studio_id: int, page: int, name: str, ids: list[int], has_next: bool, now: int
    ) -> None:
        async with self._write:
            await self.conn.execute(
                "INSERT INTO studio_pages (studio_id, page, name, ids, has_next, synced_at) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(studio_id, page) DO UPDATE SET name = excluded.name, ids = excluded.ids, "
                "has_next = excluded.has_next, synced_at = excluded.synced_at",
                (studio_id, page, name, json.dumps(ids), int(has_next), now),
            )
            await self.conn.commit()

    async def upsert_partial(self, rows: list[dict[str, Any]], now: int) -> None:
        """Неполные записи (из списка студии, из связей): полную запись они не затирают."""
        async with self._write:
            await self._upsert_partial_locked(rows, now)
            await self.conn.commit()

    async def mark_season(self, key: str, now: int, total: int) -> None:
        async with self._write:
            await self.conn.execute(
                "INSERT INTO season_sync (key, synced_at, total) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET synced_at = excluded.synced_at, total = excluded.total",
                (key, now, total),
            )
            await self.conn.commit()

    async def release_from_season(self, season: str, year: int, keep_ids: set[int]) -> int:
        """Тайтлы, которые AniList больше не относит к сезону, убираем из него.

        Вызывать только после полностью успешной выборки всех страниц.
        """
        async with self._write:
            async with self.conn.execute(
                "SELECT id FROM titles WHERE season = ? AND season_year = ? AND partial = 0",
                (season, year),
            ) as cur:
                stale = [r["id"] async for r in cur if r["id"] not in keep_ids]
            await self._execute_in("UPDATE titles SET season = NULL, season_year = NULL WHERE id IN ({marks})", stale)
            await self.conn.commit()
            return len(stale)

    async def apply_ru(self, names: dict[int, str], answered: set[int], now: int) -> None:
        """Записать русские названия (по MAL ID) и отметить, что для этих ID уже спрашивали."""
        if not answered:
            return
        async with self._write:
            rows = await self._select_in(
                "SELECT id, mal_id, title_ru, title_english, title_romaji, title_native "
                "FROM titles WHERE mal_id IN ({marks})",
                list(answered),
            )
            params = []
            for r in rows:
                row = dict(r)
                row["title_ru"] = names.get(row["mal_id"]) or row["title_ru"]
                params.append((row["title_ru"], build_search_text(row), now, row["id"]))
            await self.conn.executemany(
                "UPDATE titles SET title_ru = ?, search_text = ?, ru_checked_at = ? WHERE id = ?", params
            )
            await self.conn.commit()

    async def mark_relations_synced(self, ids: Sequence[int], now: int) -> None:
        """Отметить, что связи этих тайтлов запрашивали (даже если AniList их не вернул)."""
        if not ids:
            return
        async with self._write:
            await self._execute_in(
                "UPDATE titles SET relations_synced_at = ? WHERE id IN ({marks}) AND relations_synced_at IS NULL",
                ids,
                before=[now],
            )
            await self.conn.commit()

    async def set_description_ru(self, title_id: int, text: str | None, now: int) -> None:
        async with self._write:
            await self.conn.execute(
                "UPDATE titles SET description_ru = ?, desc_ru_checked_at = ? WHERE id = ?",
                (text, now, title_id),
            )
            await self.conn.commit()
