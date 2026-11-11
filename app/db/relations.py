"""Связи между тайтлами."""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from app.db.base import DbBase, marks


class RelationsMixin(DbBase):
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
                f"AND relation_type IN ({marks(len(kinds))})",
                ids,
                after=kinds,
            )
            out.update((r["source_id"], r["target_id"]) for r in rows)
        return sorted(out)

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
