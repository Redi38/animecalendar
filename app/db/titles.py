"""Чтение и запись тайтлов."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.db.base import DbBase
from app.db.schema import BASIC, FULL_ONLY, LIGHT
from app.i18n import normalize, search_stem


def build_search_text(row: dict[str, Any]) -> str:
    parts = (row.get("title_ru"), row.get("title_english"), row.get("title_romaji"), row.get("title_native"))
    return "\n".join(n for n in (normalize(p) for p in parts) if n)


class TitlesMixin(DbBase):
    async def get_titles(self, ids: Sequence[int], *, full: bool = False) -> dict[int, dict[str, Any]]:
        """Записи по ID. full=True добавляет описания и поисковый индекс (нужны только карточке тайтла)."""
        cols = "*" if full else LIGHT
        rows = await self._select_in(f"SELECT {cols} FROM titles WHERE id IN ({{marks}})", ids)
        return {r["id"]: dict(r) for r in rows}

    async def search_local(self, query: str, limit: int = 60) -> list[dict[str, Any]]:
        """Все слова запроса должны встретиться в названиях (на любом языке)."""
        tokens = [search_stem(t) for t in normalize(query).split()]
        if not tokens:
            return []
        where = " AND ".join("instr(search_text, ?) > 0" for _ in tokens)
        async with self.conn.execute(
            f"SELECT {LIGHT} FROM titles WHERE {where} ORDER BY popularity DESC LIMIT ?",
            [*tokens, limit],
        ) as cur:
            return [dict(r) async for r in cur]

    async def ids_needing_ru(self, ids: Sequence[int], checked_before: int) -> list[tuple[int, int]]:
        """(id, mal_id) из ids, для которых русское название ещё не искали или давно не проверяли."""
        rows = await self._select_in(
            "SELECT id, mal_id FROM titles WHERE id IN ({marks}) AND mal_id IS NOT NULL AND title_ru IS NULL "
            "AND (ru_checked_at IS NULL OR ru_checked_at < ?)",
            ids,
            after=[checked_before],
        )
        return [(r["id"], r["mal_id"]) for r in rows]

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
            await self._upsert_rows(rows, ["id", *BASIC, *FULL_ONLY], partial=False, now=now)

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
        await self._upsert_rows(list(unique.values()), ["id", *BASIC], partial=True, now=now)

    async def upsert_partial(self, rows: list[dict[str, Any]], now: int) -> None:
        """Неполные записи (из списка студии, из связей): полную запись они не затирают."""
        async with self._write:
            await self._upsert_partial_locked(rows, now)
            await self.conn.commit()

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

    async def set_description_ru(self, title_id: int, text: str | None, now: int) -> None:
        async with self._write:
            await self.conn.execute(
                "UPDATE titles SET description_ru = ?, desc_ru_checked_at = ? WHERE id = ?",
                (text, now, title_id),
            )
            await self.conn.commit()
