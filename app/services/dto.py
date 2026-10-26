"""Строки БД -> JSON для интерфейса."""

from __future__ import annotations

from typing import Any

from app.i18n import FORMAT_RU, GENRE_RU, RELATION_RU, SOURCE_RU, STATUS_RU, normalize
from app.json_util import loads_list
from app.seasons import SEASON_RU, label


def display_title(row: dict[str, Any]) -> str:
    return (
        row.get("title_ru")
        or row.get("title_english")
        or row.get("title_romaji")
        or row.get("title_native")
        or f"Аниме #{row['id']}"
    )


def subtitle(row: dict[str, Any], main: str) -> str | None:
    """Оригинальное название под русским (английское, иначе романдзи)."""
    main_norm = normalize(main)
    for key in ("title_english", "title_romaji", "title_native"):
        value = row.get(key)
        if value and normalize(value) != main_norm:
            return value
    return None


def start_iso(row: dict[str, Any]) -> tuple[str | None, str | None]:
    """(дата, точность): '2026-10-06'/'day', '2026-10'/'month', '2026'/'year' или (None, None)."""
    y, m, d = row.get("start_year"), row.get("start_month"), row.get("start_day")
    if y and m and d:
        return f"{y:04d}-{m:02d}-{d:02d}", "day"
    if y and m:
        return f"{y:04d}-{m:02d}", "month"
    if y:
        return f"{y:04d}", "year"
    return None, None


def start_sort_key(start: str | None) -> str:
    """Ключ сортировки по дате премьеры: неточные даты уходят в конец своего периода, неизвестные — в самый конец."""
    if not start:
        return "9999-99-99"
    parts = start.split("-")
    month = parts[1] if len(parts) > 1 else "13"
    day = parts[2] if len(parts) > 2 else "32"
    return f"{parts[0]}-{month}-{day}"


def card(row: dict[str, Any], *, now: int) -> dict[str, Any]:
    main = display_title(row)
    start, precision = start_iso(row)
    nxt = None
    if row.get("next_ep_at") and row["next_ep_at"] > now - 3600:
        nxt = {"at": row["next_ep_at"], "number": row.get("next_ep_number")}
    season = row.get("season")
    fmt = row.get("format")
    status = row.get("status")
    score = row.get("score")
    return {
        "id": row["id"],
        "title": main,
        "subtitle": subtitle(row, main),
        "title_native": row.get("title_native"),
        "has_ru": bool(row.get("title_ru")),
        "format": fmt,
        "format_ru": FORMAT_RU.get(fmt, fmt) if fmt else None,
        "status": status,
        "status_ru": STATUS_RU.get(status, status) if status else None,
        "season": season,
        "season_year": row.get("season_year"),
        "season_label": label(season, row["season_year"]) if season and row.get("season_year") else None,
        "start": start,
        "start_precision": precision,
        "episodes": row.get("episodes"),
        "next_episode": nxt,
        "cover": row.get("cover"),
        "color": row.get("cover_color"),
        "genres": [GENRE_RU.get(g, g) for g in loads_list(row.get("genres"))],
        "studios": loads_list(row.get("studios")),
        "score": round(score / 10, 1) if score else None,
        "popularity": row.get("popularity") or 0,
        "partial": bool(row.get("partial")),
    }


def detail(
    row: dict[str, Any],
    *,
    now: int,
    relations: list[dict[str, Any]],
    shikimori_base: str,
) -> dict[str, Any]:
    out = card(row, now=now)
    ru_text = row.get("description_ru")
    out.update(
        {
            "title_romaji": row.get("title_romaji"),
            "title_english": row.get("title_english"),
            "duration": row.get("duration"),
            "source": row.get("source"),
            "source_ru": SOURCE_RU.get(row["source"], row["source"]) if row.get("source") else None,
            "season_ru": SEASON_RU.get(row["season"]) if row.get("season") else None,
            "description": ru_text or row.get("description"),
            "description_lang": "ru" if ru_text else ("en" if row.get("description") else None),
            "relations": relations,
            "links": {
                "anilist": f"https://anilist.co/anime/{row['id']}",
                "mal": f"https://myanimelist.net/anime/{row['mal_id']}" if row.get("mal_id") else None,
                "shikimori": f"{shikimori_base.rstrip('/')}/animes/{row['mal_id']}" if row.get("mal_id") else None,
            },
        }
    )
    return out


def relation_entry(target: dict[str, Any], relation: str, *, now: int) -> dict[str, Any]:
    entry = card(target, now=now)
    entry["relation"] = relation
    entry["relation_ru"] = RELATION_RU.get(relation, relation)
    return entry
