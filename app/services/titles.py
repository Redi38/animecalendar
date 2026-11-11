"""Карточки тайтлов: список по ID, подробная карточка со связями, данные для поиска на сайте просмотра."""

from __future__ import annotations

import logging

from app.json_util import loads_studios
from app.providers.anilist import AniListError
from app.services import dto
from app.services.errors import NotFound
from app.services.ingest import Ingest

logger = logging.getLogger(__name__)

DESC_RECHECK = 14 * 86400


class TitleService:
    def __init__(self, ingest: Ingest) -> None:
        self.ingest = ingest
        self.db = ingest.db

    async def titles_by_ids(self, ids: list[int]) -> tuple[list[dict], list[int]]:
        """Карточки по ID в том же порядке. Второй элемент — ID, которые найти не удалось."""
        unique = list(dict.fromkeys(ids))
        rows = await self.db.get_titles(unique)
        missing = [i for i in unique if i not in rows]
        if missing:
            try:
                await self.ingest.fetch_and_store(missing)
            except AniListError as e:
                logger.warning("не удалось догрузить %d тайтлов: %s", len(missing), e)
            rows = await self.db.get_titles(unique)
        await self.ingest.enrich_ru(list(rows), wait=6.0)
        rows = await self.db.get_titles(list(rows))
        now = self.ingest.now()
        cards = [dto.card(rows[i], now=now) for i in unique if i in rows]
        return cards, [i for i in unique if i not in rows]

    @staticmethod
    def _studios_lack_ids(row: dict) -> bool:
        """Запись сохранена до того, как мы начали хранить ID студий: один раз обновим её, чтобы студия стала ссылкой."""
        return any(s["id"] is None for s in loads_studios(row.get("studios")))

    async def detail(self, title_id: int) -> dict:
        rows = await self.db.get_titles([title_id], full=True)
        row = rows.get(title_id)
        if row is None or row["partial"] or self._studios_lack_ids(row):
            try:
                await self.ingest.fetch_and_store([title_id])
            except AniListError:
                if row is None:
                    raise
            row = (await self.db.get_titles([title_id], full=True)).get(title_id)
        if row is None:
            raise NotFound(title_id)

        await self.ingest.enrich_ru([title_id], wait=4.0)
        row = (await self.db.get_titles([title_id], full=True))[title_id]

        if row.get("mal_id") and row.get("description_ru") is None and self.ingest.shikimori.enabled:
            checked = row.get("desc_ru_checked_at")
            if checked is None or self.ingest.now() - checked > DESC_RECHECK:
                text = await self.ingest.shikimori.description(row["mal_id"])
                if text is not None:  # None — запрос не удался, попробуем в следующий раз
                    await self.db.set_description_ru(title_id, text or None, self.ingest.now())
                    row["description_ru"] = text or None

        edges = (await self.db.relations_from([title_id])).get(title_id, [])
        targets = await self.db.get_titles([t for t, _ in edges])
        now = self.ingest.now()
        relations = [dto.relation_entry(targets[t], rel, now=now) for t, rel in edges if t in targets]
        order = {"PREQUEL": 0, "SEQUEL": 1, "PARENT": 2, "SIDE_STORY": 3, "SPIN_OFF": 4}
        relations.sort(key=lambda r: (order.get(r["relation"], 9), r["start"] or "9999"))
        return dto.detail(row, now=now, relations=relations)

    async def watch_query(self, title_id: int) -> tuple[list[str], int | None, int | None]:
        """Данные для поиска страницы тайтла на сайте просмотра: (названия, MAL ID, год)."""
        row = (await self.db.get_titles([title_id])).get(title_id)
        if row is None:
            raise NotFound(title_id)
        names = [row.get("title_ru"), row.get("title_english"), row.get("title_romaji")]
        return [n for n in names if n], row.get("mal_id"), row.get("start_year") or row.get("season_year")
