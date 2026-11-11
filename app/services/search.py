"""Поиск по каталогу: локальная база, затем AniList и Shikimori."""

from __future__ import annotations

import logging

from app.i18n import has_cyrillic, normalize
from app.providers.anilist import AniListError
from app.services import dto
from app.services.ingest import Ingest

logger = logging.getLogger(__name__)

SEARCH_CACHE_TTL = 600
SEARCH_CACHE_MAX = 500


class SearchService:
    def __init__(self, ingest: Ingest) -> None:
        self.ingest = ingest
        self.db = ingest.db
        self._cache: dict[str, tuple[float, list[int]]] = {}

    @staticmethod
    def _rank(rows: list[dict], query: str) -> list[dict]:
        q = normalize(query)

        def key(row: dict) -> tuple[int, int]:
            names = [normalize(row.get(k)) for k in ("title_ru", "title_english", "title_romaji", "title_native")]
            names = [n for n in names if n]
            if q in names:
                tier = 0
            elif any(n.startswith(q) for n in names):
                tier = 1
            elif any(f" {q}" in f" {n}" for n in names):
                tier = 2
            else:
                tier = 3
            return tier, -(row.get("popularity") or 0)

        return sorted(rows, key=key)

    async def search(self, query: str, *, deep: bool = False, limit: int = 30) -> list[dict]:
        q = query.strip()[:100]
        if len(normalize(q)) < 2:
            return []
        ranked = self._rank(await self.db.search_local(q, 80), q)
        # В быстром режиме (подсказки при наборе) ходим во внешние API, только если локально почти пусто.
        if deep or len(ranked) < 6:
            remote_ids = await self._remote_search(q)
            if remote_ids:
                have = {r["id"] for r in ranked}
                fresh = await self.db.get_titles([i for i in remote_ids if i not in have])
                ranked.extend(fresh[i] for i in remote_ids if i in fresh)
        top = ranked[:limit]
        # Русские названия найденных тайтлов: при полном поиске подождём немного, при подсказках — доедут в фоне.
        no_ru = [r["id"] for r in top if not r.get("title_ru")]
        if no_ru:
            await self.ingest.enrich_ru(no_ru, wait=2.5 if deep else None)
            fresh_rows = await self.db.get_titles([r["id"] for r in top])
            top = [fresh_rows.get(r["id"], r) for r in top]
        now = self.ingest.now()
        return [dto.card(r, now=now) for r in top]

    async def _remote_search(self, q: str) -> list[int]:
        key = normalize(q)
        cached = self._cache.get(key)
        if cached and self.ingest.now() - cached[0] < SEARCH_CACHE_TTL:
            return cached[1]
        try:
            if has_cyrillic(q):
                hits = await self.ingest.shikimori.search(q, 12)
                if not hits:
                    ids: list[int] = []
                else:
                    media = await self.ingest.anilist.by_mal_ids([h["mal_id"] for h in hits])
                    found = await self.ingest.store(media)
                    names = {h["mal_id"]: h["russian"] for h in hits if h["russian"]}
                    await self.db.apply_ru(names, {h["mal_id"] for h in hits}, self.ingest.now())
                    by_mal = {m["idMal"]: m["id"] for m in media if m.get("idMal") and m["id"] in found}
                    ids = [by_mal[h["mal_id"]] for h in hits if h["mal_id"] in by_mal]
            else:
                media = await self.ingest.anilist.search(q, 12)
                found = await self.ingest.store(media)
                ids = [m["id"] for m in media if m["id"] in found]
                await self.ingest.enrich_ru(ids, wait=3.0)
        except AniListError as e:
            logger.warning("внешний поиск %r не удался: %s", q, e)
            return []
        if len(self._cache) >= SEARCH_CACHE_MAX:
            self._cache.clear()
        self._cache[key] = (self.ingest.now(), ids)
        return ids
