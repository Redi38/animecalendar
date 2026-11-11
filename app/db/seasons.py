"""Сезоны: выборки для календаря, отметки синхронизации."""

from __future__ import annotations

from typing import Any

from app.db.base import DbBase
from app.db.schema import LIGHT


class SeasonsMixin(DbBase):
    async def season_titles(self, season: str, year: int) -> list[dict[str, Any]]:
        async with self.conn.execute(
            f"SELECT {LIGHT} FROM titles WHERE season = ? AND season_year = ? ORDER BY popularity DESC, id",
            (season, year),
        ) as cur:
            return [dict(r) async for r in cur]

    async def tba_titles(self, since: int) -> list[dict[str, Any]]:
        """Анонсы без сезона и даты, подтверждённые свежей выборкой (synced_at >= since)."""
        async with self.conn.execute(
            f"SELECT {LIGHT} FROM titles WHERE status = 'NOT_YET_RELEASED' AND season_year IS NULL "
            "AND start_year IS NULL AND partial = 0 AND synced_at >= ? ORDER BY popularity DESC, id",
            (since,),
        ) as cur:
            return [dict(r) async for r in cur]

    async def season_synced_at(self, key: str) -> int | None:
        async with self.conn.execute("SELECT synced_at FROM season_sync WHERE key = ?", (key,)) as cur:
            row = await cur.fetchone()
        return row["synced_at"] if row else None

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
