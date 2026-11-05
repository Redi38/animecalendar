"""Франшизы: тайтлы, которые связаны сезонами, фильмами, OVA и спешлами, собираются в одну группу.

Граф связей AniList неориентированный для нас: «2 — продолжение 1» и «1 — предыстория 2» дают одно ребро.
Спин-оффы, альтернативные версии и сборники в группу не входят — они склеивают в один клубок разные франшизы.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.providers.anilist import AniListError
from app.services import dto
from app.services.ingest import Ingest

logger = logging.getLogger(__name__)

GROUP_TYPES: frozenset[str] = frozenset({"SEQUEL", "PREQUEL", "PARENT", "SIDE_STORY"})
MAX_ROUNDS = 12  # на сколько шагов уходим от исходного тайтла по цепочке сезонов
MAX_NODES = 3000  # потолок на один запрос: защита от гигантских клубков связей
MAX_GROUP_SIZE = 60  # в ответ попадает не больше стольких тайтлов одной группы


@dataclass
class Group:
    root: int  # главный тайтл: по нему называется группа
    members: list[int]  # все тайтлы группы по дате премьеры
    seeds: list[int] = field(default_factory=list)  # те, что запрошены (просмотренные или найденные поиском)


def components(nodes: Iterable[int], edges: Iterable[tuple[int, int]]) -> list[list[int]]:
    """Связные компоненты графа. Порядок: по первому встретившемуся узлу."""
    parent: dict[int, int] = {n: n for n in nodes}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in edges:
        parent.setdefault(a, a)
        parent.setdefault(b, b)
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    out: dict[int, list[int]] = {}
    for n in parent:
        out.setdefault(find(n), []).append(n)
    return list(out.values())


def _order_key(row: dict[str, Any] | None, title_id: int) -> tuple[str, int]:
    start = dto.start_iso(row)[0] if row else None
    return dto.start_sort_key(start), title_id


def order_members(members: Sequence[int], rows: dict[int, dict[str, Any]]) -> list[int]:
    return sorted(members, key=lambda i: _order_key(rows.get(i), i))


def pick_root(members: Sequence[int], rows: dict[int, dict[str, Any]]) -> int:
    """Название группы берём у самого раннего сериала (TV); нет сериалов — у самого раннего тайтла."""
    ordered = order_members(members, rows)
    for i in ordered:
        if (rows.get(i) or {}).get("format") == "TV":
            return i
    return ordered[0]


class GroupService:
    def __init__(self, ingest: Ingest) -> None:
        self.ingest = ingest
        self.db = ingest.db

    async def _expand(self, seeds: Sequence[int]) -> tuple[set[int], set[tuple[int, int]]]:
        seen = set(seeds)
        edges: set[tuple[int, int]] = set()
        frontier = set(seeds)
        for _ in range(MAX_ROUNDS):
            if not frontier or len(seen) > MAX_NODES:
                break
            nxt: set[int] = set()
            for a, b in await self.db.group_edges(list(frontier), GROUP_TYPES):
                edges.add((a, b))
                for n in (a, b):
                    if n not in seen:
                        seen.add(n)
                        nxt.add(n)
            frontier = nxt
        return seen, edges

    async def _load_relations(self, ids: Iterable[int], budget: int) -> None:
        """Подкачать связи у тайтлов, которых мы ещё не видели целиком (не больше budget штук)."""
        ids = list(ids)
        if budget <= 0 or not ids:
            return
        rows = await self.db.get_titles(ids)
        todo = [i for i in ids if i not in rows or rows[i].get("relations_synced_at") is None][:budget]
        if not todo:
            return
        try:
            await self.ingest.fetch_and_store(todo)
        except AniListError as e:
            logger.warning("groups: не удалось догрузить связи %d тайтлов: %s", len(todo), e)

    async def build(self, seeds: Sequence[int], *, fetch_budget: int = 0) -> list[Group]:
        """Группы для списка тайтлов; порядок групп — по первому тайтлу из seeds.

        fetch_budget — сколько тайтлов можно докачать у AniList, чтобы достроить цепочки.
        Докачка идёт в два захода: сначала сами тайтлы, потом новые участники групп.
        """
        seeds = list(dict.fromkeys(seeds))
        if not seeds:
            return []
        budget = fetch_budget
        await self._load_relations(seeds, min(budget, len(seeds)))
        budget = max(0, budget - len(seeds))
        seen, edges = await self._expand(seeds)
        seed_set = set(seeds)
        if budget > 0 and len(seen) > len(seed_set):
            await self._load_relations([n for n in seen if n not in seed_set], budget)
            seen, edges = await self._expand(seeds)

        rows = await self.db.get_titles(list(seen))
        position = {s: i for i, s in enumerate(seeds)}
        groups: list[Group] = []
        for comp in components(seen, edges):
            comp_seeds = sorted((n for n in comp if n in position), key=position.__getitem__)
            if not comp_seeds:
                continue
            members = order_members(comp, rows)
            groups.append(Group(root=pick_root(members, rows), members=members, seeds=comp_seeds))
        groups.sort(key=lambda g: position[g.seeds[0]])
        return groups
