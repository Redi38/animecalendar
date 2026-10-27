"""Каталог: сезоны, карточки, поиск и связанные анонсы поверх SQLite-кэша.

Данные берутся из AniList (структура, даты, связи) и Shikimori (русские
названия и описания). Всё, что пришло, оседает в БД, поэтому повторные
запросы дешёвые, а сайт переживает кратковременные сбои внешних API.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from collections.abc import Callable, Coroutine
from datetime import UTC, date, datetime
from typing import Any

from app.db import Database
from app.i18n import has_cyrillic, normalize
from app.providers.anilist import AniListClient, AniListError, is_tba, parse_media, parse_relations
from app.providers.shikimori import ShikimoriClient
from app.seasons import season_of, ttl_seconds
from app.services import dto
from app.services.related import CHAIN_TYPES, MAX_DEPTH, walk

logger = logging.getLogger(__name__)

MAX_PAGES = 12  # 600 тайтлов на сезон — с запасом
TBA_KEY = "tba"
TBA_TTL = 6 * 3600
MAX_TBA_PAGES = 10  # самые популярные 500 анонсов; без даты из них остаётся лишь часть
TBA_WINDOW = 1800  # запись считается свежей, если её сохранила выборка не раньше, чем за столько секунд
RU_RECHECK = 7 * 86400  # как часто повторно искать русское название, которого нет
DESC_RECHECK = 14 * 86400
RELATIONS_TTL_ACTIVE = 12 * 3600  # анонсы и идущие тайтлы меняются часто
RELATIONS_TTL_DONE = 14 * 86400
FETCH_BUDGET = 150  # сколько тайтлов можно запросить у AniList за один вызов related()
SEARCH_CACHE_TTL = 600
SEARCH_CACHE_MAX = 500
ANNOUNCED = ("NOT_YET_RELEASED", "RELEASING")


class NotFound(Exception):
    pass


class Catalog:
    def __init__(
        self,
        db: Database,
        anilist: AniListClient,
        shikimori: ShikimoriClient,
        *,
        shikimori_base: str = "https://shikimori.io",
        clock: Callable[[], float] = time.time,
        allow_adult: bool = False,
    ) -> None:
        self.allow_adult = allow_adult
        self.db = db
        self.anilist = anilist
        self.shikimori = shikimori
        self.shikimori_base = shikimori_base
        self._clock = clock
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._tasks: set[asyncio.Task] = set()
        self._refreshing: set[str] = set()
        self._search_cache: dict[str, tuple[float, list[int]]] = {}

    # --- служебное -----------------------------------------------------------

    def now(self) -> int:
        return int(self._clock())

    def today(self) -> date:
        return datetime.fromtimestamp(self._clock(), UTC).date()

    def _spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._tasks.add(task)

        def _done(t: asyncio.Task) -> None:
            self._tasks.discard(t)
            if not t.cancelled() and t.exception() is not None:
                logger.warning("фоновая задача упала: %r", t.exception())

        task.add_done_callback(_done)
        return task

    async def drain(self) -> None:
        """Дождаться фоновых задач (для тестов и корректного выключения)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*list(self._tasks), return_exceptions=True)

    # --- загрузка из AniList ----------------------------------------------------

    async def _store(self, media: list[dict]) -> set[int]:
        rows: list[dict] = []
        relations: dict[int, list[tuple[int, str]]] = {}
        nodes: list[dict] = []
        for m in media:
            if m.get("type") not in (None, "ANIME") or (m.get("isAdult") and not self.allow_adult):
                continue
            row = parse_media(m)
            edges, partial_nodes = parse_relations(m, allow_adult=self.allow_adult)
            rows.append(row)
            relations[row["id"]] = edges
            nodes.extend(partial_nodes)
        await self.db.upsert_full(rows, relations, nodes, self.now())
        return {r["id"] for r in rows}

    async def _fetch_and_store(self, ids: list[int]) -> set[int]:
        media = await self.anilist.by_ids(ids)
        found = await self._store(media)
        # id, которых у AniList нет (не аниме, удалены), не стоит запрашивать при каждом обращении.
        await self.db.mark_relations_synced([i for i in ids if i not in found], self.now())
        return found

    # --- русские названия ------------------------------------------------------

    async def _enrich_ru(self, ids: list[int], wait: float | None = None) -> None:
        """Подтянуть русские названия; ждём не дольше wait секунд, остальное доедет в фоне."""
        if not self.shikimori.enabled or not ids:
            return
        pending = await self.db.ids_needing_ru(ids, self.now() - RU_RECHECK)
        if not pending:
            return
        mal_ids = sorted({mal for _, mal in pending})

        async def work() -> None:
            names, answered = await self.shikimori.russian_names(mal_ids)
            await self.db.apply_ru(names, answered, self.now())

        task = self._spawn(work())
        if wait:
            await asyncio.wait({task}, timeout=wait)

    # --- сезоны ----------------------------------------------------------------

    async def season(self, year: int, season: str) -> tuple[list[dict], int | None]:
        key = f"{year}-{season}"
        synced = await self.db.season_synced_at(key)
        ttl = ttl_seconds(season, year, self.today())
        if synced is None:
            await self._refresh_season(year, season)
        elif self.now() - synced > ttl and key not in self._refreshing:
            self._refreshing.add(key)
            self._spawn(self._refresh_quietly(year, season, key))
        rows = await self.db.season_titles(season, year)
        return rows, await self.db.season_synced_at(key)

    async def _refresh_quietly(self, year: int, season: str, key: str) -> None:
        try:
            await self._refresh_season(year, season)
        except AniListError as e:
            logger.warning("не удалось обновить сезон %s: %s", key, e)
        finally:
            self._refreshing.discard(key)

    async def _refresh_season(self, year: int, season: str) -> None:
        key = f"{year}-{season}"
        async with self._locks[key]:
            synced = await self.db.season_synced_at(key)
            if synced is not None and self.now() - synced <= ttl_seconds(season, year, self.today()):
                return  # пока ждали замок, сезон уже обновил другой запрос

            media: list[dict] = []
            page, has_next = 1, True
            while has_next and page <= MAX_PAGES:
                chunk, has_next = await self.anilist.season_page(season, year, page)
                media.extend(chunk)
                page += 1

            ids = await self._store(media)
            if not has_next:
                dropped = await self.db.release_from_season(season, year, ids)
                if dropped:
                    logger.info("сезон %s: убрано тайтлов, переехавших в другой сезон: %d", key, dropped)
            await self.db.mark_season(key, self.now(), len(ids))
            logger.info("сезон %s обновлён: %d тайтлов", key, len(ids))
            await self._enrich_ru(sorted(ids), wait=8.0)

    # --- анонсы без даты --------------------------------------------------------

    async def tba(self) -> tuple[list[dict], int | None]:
        synced = await self.db.season_synced_at(TBA_KEY)
        if synced is None:
            await self._refresh_tba()
        elif self.now() - synced > TBA_TTL and TBA_KEY not in self._refreshing:
            self._refreshing.add(TBA_KEY)
            self._spawn(self._refresh_tba_quietly())
        synced = await self.db.season_synced_at(TBA_KEY)
        return await self.db.tba_titles((synced or 0) - TBA_WINDOW), synced

    async def _refresh_tba_quietly(self) -> None:
        try:
            await self._refresh_tba()
        except AniListError as e:
            logger.warning("не удалось обновить анонсы без даты: %s", e)
        finally:
            self._refreshing.discard(TBA_KEY)

    async def _refresh_tba(self) -> None:
        async with self._locks[TBA_KEY]:
            synced = await self.db.season_synced_at(TBA_KEY)
            if synced is not None and self.now() - synced <= TBA_TTL:
                return  # пока ждали замок, анонсы уже обновил другой запрос
            media: list[dict] = []
            page, has_next = 1, True
            while has_next and page <= MAX_TBA_PAGES:
                chunk, has_next = await self.anilist.tba_page(page)
                media.extend(m for m in chunk if is_tba(m))
                page += 1
            ids = await self._store(media)
            await self.db.mark_season(TBA_KEY, self.now(), len(ids))
            logger.info("анонсы без даты обновлены: %d тайтлов", len(ids))
            await self._enrich_ru(sorted(ids), wait=8.0)

    async def prewarm(self) -> None:
        """Текущий и следующий сезоны — к моменту первого визита."""
        from app.seasons import shift

        season, year = season_of(self.today())
        nxt_season, nxt_year = shift(season, year, 1)
        for y, s in ((year, season), (nxt_year, nxt_season)):
            try:
                await self.season(y, s)
            except AniListError as e:
                logger.warning("прогрев сезона %s-%s не удался: %s", y, s, e)
        try:
            await self.tba()
        except AniListError as e:
            logger.warning("прогрев анонсов без даты не удался: %s", e)

    # --- карточки --------------------------------------------------------------

    async def titles_by_ids(self, ids: list[int]) -> tuple[list[dict], list[int]]:
        """Карточки по ID в том же порядке. Второй элемент — ID, которые найти не удалось."""
        unique = list(dict.fromkeys(ids))
        rows = await self.db.get_titles(unique)
        missing = [i for i in unique if i not in rows]
        if missing:
            try:
                await self._fetch_and_store(missing)
            except AniListError as e:
                logger.warning("не удалось догрузить %d тайтлов: %s", len(missing), e)
            rows = await self.db.get_titles(unique)
        await self._enrich_ru(list(rows), wait=6.0)
        rows = await self.db.get_titles(list(rows))
        now = self.now()
        cards = [dto.card(rows[i], now=now) for i in unique if i in rows]
        return cards, [i for i in unique if i not in rows]

    async def detail(self, title_id: int) -> dict:
        rows = await self.db.get_titles([title_id])
        row = rows.get(title_id)
        if row is None or row["partial"]:
            try:
                await self._fetch_and_store([title_id])
            except AniListError:
                if row is None:
                    raise
            row = (await self.db.get_titles([title_id])).get(title_id)
        if row is None:
            raise NotFound(title_id)

        await self._enrich_ru([title_id], wait=4.0)
        row = (await self.db.get_titles([title_id]))[title_id]

        if row.get("mal_id") and row.get("description_ru") is None and self.shikimori.enabled:
            checked = row.get("desc_ru_checked_at")
            if checked is None or self.now() - checked > DESC_RECHECK:
                text = await self.shikimori.description(row["mal_id"])
                if text is not None:  # None — запрос не удался, попробуем в следующий раз
                    await self.db.set_description_ru(title_id, text or None, self.now())
                    row["description_ru"] = text or None

        edges = (await self.db.relations_from([title_id])).get(title_id, [])
        targets = await self.db.get_titles([t for t, _ in edges])
        now = self.now()
        relations = [dto.relation_entry(targets[t], rel, now=now) for t, rel in edges if t in targets]
        order = {"PREQUEL": 0, "SEQUEL": 1, "PARENT": 2, "SIDE_STORY": 3, "SPIN_OFF": 4}
        relations.sort(key=lambda r: (order.get(r["relation"], 9), r["start"] or "9999"))
        return dto.detail(row, now=now, relations=relations, shikimori_base=self.shikimori_base)

    # --- поиск -----------------------------------------------------------------

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
            await self._enrich_ru(no_ru, wait=2.5 if deep else None)
            fresh_rows = await self.db.get_titles([r["id"] for r in top])
            top = [fresh_rows.get(r["id"], r) for r in top]
        now = self.now()
        return [dto.card(r, now=now) for r in top]

    async def _remote_search(self, q: str) -> list[int]:
        key = normalize(q)
        cached = self._search_cache.get(key)
        if cached and self._clock() - cached[0] < SEARCH_CACHE_TTL:
            return cached[1]
        try:
            if has_cyrillic(q):
                hits = await self.shikimori.search(q, 12)
                if not hits:
                    ids: list[int] = []
                else:
                    media = await self.anilist.by_mal_ids([h["mal_id"] for h in hits])
                    found = await self._store(media)
                    names = {h["mal_id"]: h["russian"] for h in hits if h["russian"]}
                    await self.db.apply_ru(names, {h["mal_id"] for h in hits}, self.now())
                    by_mal = {m["idMal"]: m["id"] for m in media if m.get("idMal") and m["id"] in found}
                    ids = [by_mal[h["mal_id"]] for h in hits if h["mal_id"] in by_mal]
            else:
                media = await self.anilist.search(q, 12)
                found = await self._store(media)
                ids = [m["id"] for m in media if m["id"] in found]
                await self._enrich_ru(ids, wait=3.0)
        except AniListError as e:
            logger.warning("внешний поиск %r не удался: %s", q, e)
            return []
        if len(self._search_cache) >= SEARCH_CACHE_MAX:
            self._search_cache.clear()
        self._search_cache[key] = (self._clock(), ids)
        return ids

    # --- связанные анонсы ------------------------------------------------------

    def _relations_stale(self, row: dict | None) -> bool:
        if row is None or row.get("relations_synced_at") is None:
            return True
        ttl = RELATIONS_TTL_ACTIVE if row.get("status") in ANNOUNCED else RELATIONS_TTL_DONE
        return self.now() - row["relations_synced_at"] > ttl

    async def related(self, watched_ids: list[int]) -> dict[str, Any]:
        """Анонсированные и выходящие тайтлы, связанные с просмотренными.

        Идём по связям AniList до MAX_DEPTH шагов; недостающие и устаревшие данные
        докачиваем пачками (не больше FETCH_BUDGET тайтлов за вызов).
        """
        watched = list(dict.fromkeys(watched_ids))
        watched_set = set(watched)
        budget = FETCH_BUDGET
        degraded = False

        async def fetch(ids: list[int]) -> None:
            nonlocal budget, degraded
            ids = ids[:budget]
            if not ids:
                return
            budget -= len(ids)
            try:
                await self._fetch_and_store(ids)
            except AniListError as e:
                degraded = True
                logger.warning("related: не удалось догрузить %d тайтлов: %s", len(ids), e)

        expanded: set[int] = set()
        frontier = set(watched)
        for _ in range(MAX_DEPTH):
            frontier -= expanded
            if not frontier:
                break
            rows = await self.db.get_titles(list(frontier))
            await fetch([i for i in frontier if self._relations_stale(rows.get(i))])
            expanded |= frontier
            edges = await self.db.relations_from(list(frontier))
            frontier = {t for src in frontier for t, rel in edges.get(src, []) if rel in CHAIN_TYPES}

        all_edges = await self.db.relations_from(list(expanded))
        hits = walk(watched, all_edges)

        rows = await self.db.get_titles(list(hits))
        # Статус и дата анонса должны быть свежими: подновляем устаревшие.
        refresh = [
            t
            for t, r in rows.items()
            if r["status"] in ANNOUNCED and self.now() - (r.get("synced_at") or 0) > RELATIONS_TTL_ACTIVE
        ]
        if refresh:
            await fetch(refresh)
            rows = await self.db.get_titles(list(hits))

        # Русские названия нужны и анонсам, и просмотренным тайтлам, из которых они выросли («из «…»»).
        via_ids = {h.via for h in hits.values() if h.target in rows and rows[h.target]["status"] in ANNOUNCED}
        announced = [t for t, r in rows.items() if r["status"] in ANNOUNCED]
        await self._enrich_ru([*announced, *via_ids], wait=6.0)
        rows = await self.db.get_titles(list(hits))
        sources = await self.db.get_titles(list(via_ids))

        now = self.now()
        items = []
        for target, hit in hits.items():
            row = rows.get(target)
            if row is None or row["status"] not in ANNOUNCED:
                continue
            item = dto.relation_entry(row, hit.relation, now=now)
            src = sources.get(hit.via)
            item["via"] = {"id": hit.via, "title": dto.display_title(src) if src else f"#{hit.via}"}
            item["also_via"] = len(hit.origins) - 1
            item["depth"] = hit.depth
            items.append(item)
        items.sort(key=lambda i: (dto.start_sort_key(i["start"]), -i["popularity"]))
        return {"items": items, "watched": len(watched_set), "degraded": degraded}
