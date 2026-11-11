"""Кэш страниц студий."""

from __future__ import annotations

import json
from typing import Any

from app.db.base import DbBase


class StudioPagesMixin(DbBase):
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
