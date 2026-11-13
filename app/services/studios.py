"""Страница студии: все тайтлы, где студия главная, от новых к старым.

Страницы берутся у AniList по одной (у крупных студий сотни тайтлов) и оседают в БД на неделю.
Тайтлы из списка приходят неполными: полную карточку они получают, когда их откроют.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.providers.anilist import AniListError
from app.providers.anilist_parse import parse_list_nodes
from app.services import dto
from app.services.errors import NotFound
from app.services.ingest import Ingest

logger = logging.getLogger(__name__)

STUDIO_TTL = 7 * 86400
MAX_PAGE = 40  # 2000 тайтлов: больше у одной студии не бывает, а запросы за край страниц отсекаем


class StudioNotFound(NotFound):
    """Такой студии нет у AniList."""


@dataclass
class StudioPage:
    id: int
    name: str
    items: list[dict[str, Any]]
    has_next: bool
    synced_at: int


def _is_not_found(error: AniListError) -> bool:
    return str(error).lower().startswith("not found")


class StudioService:
    def __init__(self, ingest: Ingest) -> None:
        self.ingest = ingest
        self.db = ingest.db

    async def view(self, studio_id: int, page: int) -> dict[str, Any]:
        """Страница студии в виде ответа API: карточки тайтлов и признак следующей страницы."""
        result = await self.page(studio_id, page)
        now = self.ingest.now()
        return {
            "id": result.id,
            "name": result.name,
            "page": page,
            "has_next": result.has_next,
            "synced_at": result.synced_at,
            "items": [dto.card(r, now=now) for r in result.items],
        }

    async def page(self, studio_id: int, page: int) -> StudioPage:
        now = self.ingest.now()
        cached = await self.db.studio_page(studio_id, page)
        if cached is None or now - cached["synced_at"] >= STUDIO_TTL:
            cached = await self._refresh(studio_id, page, cached, now)
        ids = cached["ids"]
        await self.ingest.enrich_ru(ids, wait=3.0)
        rows = await self.db.get_titles(ids)
        return StudioPage(
            id=studio_id,
            name=cached["name"],
            items=[rows[i] for i in ids if i in rows],
            has_next=cached["has_next"],
            synced_at=cached["synced_at"],
        )

    async def _refresh(self, studio_id: int, page: int, stale: dict[str, Any] | None, now: int) -> dict[str, Any]:
        """Страница у AniList. Если он недоступен, а старая копия есть, показываем её."""
        try:
            name, nodes, has_next = await self.ingest.anilist.studio_page(studio_id, page)
        except AniListError as e:
            if _is_not_found(e):
                raise StudioNotFound(studio_id) from None
            if stale is not None:
                logger.warning(
                    "studio %d: AniList недоступен, показываем сохранённую страницу %d: %s", studio_id, page, e
                )
                return stale
            raise
        if not name:
            raise StudioNotFound(studio_id)
        rows = parse_list_nodes(nodes, allow_adult=self.ingest.allow_adult)
        await self.db.upsert_partial(rows, now)
        ids = [r["id"] for r in rows]
        await self.db.save_studio_page(studio_id, page, name, ids, has_next, now)
        return {"name": name, "ids": ids, "has_next": has_next, "synced_at": now}
