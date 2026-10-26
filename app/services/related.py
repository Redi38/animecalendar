"""Поиск связанных тайтлов по графу связей AniList (чистая логика, без сети и БД)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

# По этим связям идём цепочкой: продолжение продолжения, предыстория предыстории и т. д.
CHAIN_TYPES: frozenset[str] = frozenset({"SEQUEL", "PREQUEL", "SIDE_STORY", "SPIN_OFF", "PARENT"})
# Эти связи берём только непосредственно от просмотренного тайтла. Идти дальше нельзя:
# «альтернативные версии» и «сборники» склеивают в один клубок целые франшизы.
LEAF_TYPES: frozenset[str] = frozenset({"ALTERNATIVE", "SUMMARY", "COMPILATION", "CONTAINS"})

MAX_DEPTH = 3


@dataclass
class Hit:
    target: int
    via: int  # ближайший просмотренный тайтл
    relation: str  # тип последней связи на пути
    depth: int
    origins: set[int] = field(default_factory=set)  # все просмотренные, из которых тайтл достижим


def walk(
    watched: Sequence[int],
    edges: Mapping[int, Sequence[tuple[int, str]]],
    max_depth: int = MAX_DEPTH,
) -> dict[int, Hit]:
    """Тайтлы, достижимые от просмотренных по связям. Сами просмотренные в результат не попадают."""
    watched_set = set(watched)
    hits: dict[int, Hit] = {}
    for origin in sorted(watched_set):
        seen = {origin}
        level = [origin]
        for depth in range(1, max_depth + 1):
            nxt: list[int] = []
            for node in level:
                for target, rel in edges.get(node, ()):
                    leaf = rel in LEAF_TYPES
                    if not leaf and rel not in CHAIN_TYPES:
                        continue
                    if leaf and depth > 1:
                        continue
                    if target in seen or target in watched_set:
                        continue
                    seen.add(target)
                    hit = hits.get(target)
                    if hit is None:
                        hits[target] = hit = Hit(target, origin, rel, depth)
                    elif depth < hit.depth:
                        hit.via, hit.relation, hit.depth = origin, rel, depth
                    hit.origins.add(origin)
                    if not leaf:
                        nxt.append(target)
            level = nxt
            if not level:
                break
    return hits
