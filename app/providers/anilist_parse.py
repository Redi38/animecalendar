"""Разбор ответов AniList в строки для БД: тайтлы, студии, связи."""

from __future__ import annotations

from typing import Any

from app.i18n import plain_text
from app.json_util import dumps


def _date(d: dict | None) -> tuple[int | None, int | None, int | None]:
    d = d or {}
    return d.get("year"), d.get("month"), d.get("day")


def _node_row(node: dict, *, partial: bool) -> dict[str, Any]:
    """Общие поля тайтла — одинаковые у полной записи и у узла связи."""
    title = node.get("title") or {}
    year, month, day = _date(node.get("startDate"))
    cover = node.get("coverImage") or {}
    return {
        "id": node["id"],
        "mal_id": node.get("idMal"),
        "title_romaji": title.get("romaji"),
        "title_english": title.get("english"),
        "title_native": title.get("native"),
        "format": node.get("format"),
        "status": node.get("status"),
        "season": node.get("season"),
        "season_year": node.get("seasonYear"),
        "start_year": year,
        "start_month": month,
        "start_day": day,
        "episodes": node.get("episodes"),
        "score": node.get("averageScore"),
        "popularity": node.get("popularity") or 0,
        "cover": cover.get("large"),
        "cover_color": cover.get("color"),
        "partial": 1 if partial else 0,
    }


def parse_studios(media: dict) -> list[dict[str, Any]]:
    """Главные студии тайтла: [{"id": 11, "name": "MAPPA"}]. Студия без ID остаётся просто названием."""
    out: list[dict[str, Any]] = []
    for s in (media.get("studios") or {}).get("nodes") or []:
        if s and s.get("name"):
            out.append({"id": s.get("id"), "name": s["name"]})
    return out


def parse_media(media: dict) -> dict[str, Any]:
    """Полная запись тайтла из Media."""
    row = _node_row(media, partial=False)
    studios = parse_studios(media)
    nxt = media.get("nextAiringEpisode") or {}
    row.update(
        {
            "duration": media.get("duration"),
            "source": media.get("source"),
            "genres": dumps(media.get("genres") or []),
            "studios": dumps(studios),
            "next_ep_at": nxt.get("airingAt"),
            "next_ep_number": nxt.get("episode"),
            "description": plain_text(media.get("description")),
        }
    )
    return row


# Музыкальные клипы в списки студий не берём: это не тайтлы, за которыми следят.
SKIPPED_FORMATS = frozenset({"MUSIC"})


def parse_list_nodes(nodes: list[dict], *, allow_adult: bool = False) -> list[dict[str, Any]]:
    """Неполные записи из списка тайтлов студии. Аниме без музыкальных клипов; взрослое — только при allow_adult."""
    out: list[dict[str, Any]] = []
    for node in nodes:
        if not node or not node.get("id") or node.get("type") not in (None, "ANIME"):
            continue
        if node.get("format") in SKIPPED_FORMATS or (node.get("isAdult") and not allow_adult):
            continue
        out.append(_node_row(node, partial=True))
    return out


def is_tba(media: dict) -> bool:
    """Анонс без даты: у тайтла нет ни сезона, ни года премьеры."""
    return not (media.get("seasonYear") or (media.get("startDate") or {}).get("year"))


def parse_relations(media: dict, *, allow_adult: bool = False) -> tuple[list[tuple[int, str]], list[dict[str, Any]]]:
    """Связи тайтла: [(target_id, relation_type)] и неполные записи целевых тайтлов.

    Берём только аниме (манга и ранобэ нам не нужны); взрослый контент — только при allow_adult.
    """
    edges: list[tuple[int, str]] = []
    nodes: list[dict[str, Any]] = []
    for edge in (media.get("relations") or {}).get("edges") or []:
        node = (edge or {}).get("node") or {}
        rel = (edge or {}).get("relationType")
        if not node.get("id") or not rel:
            continue
        if node.get("type") != "ANIME" or (node.get("isAdult") and not allow_adult):
            continue
        edges.append((node["id"], rel))
        nodes.append(_node_row(node, partial=True))
    return edges, nodes
