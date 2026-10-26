"""Календарные сезоны аниме: Зима (янв–мар), Весна (апр–июн), Лето (июл–сен), Осень (окт–дек)."""

from __future__ import annotations

from datetime import date

SEASONS: tuple[str, ...] = ("WINTER", "SPRING", "SUMMER", "FALL")

SEASON_RU: dict[str, str] = {
    "WINTER": "Зима",
    "SPRING": "Весна",
    "SUMMER": "Лето",
    "FALL": "Осень",
}

MIN_YEAR = 1980

# Сколько сезонов вперёд AniList обычно уже знает: анонсы бывают на год-полтора вперёд.
MAX_YEARS_AHEAD = 2


def season_of(d: date) -> tuple[str, int]:
    """(сезон, год) для календарной даты."""
    return SEASONS[(d.month - 1) // 3], d.year


def shift(season: str, year: int, delta: int) -> tuple[str, int]:
    """Сместиться на delta сезонов вперёд (или назад, если delta < 0)."""
    index = year * 4 + SEASONS.index(season) + delta
    return SEASONS[index % 4], index // 4


def parse_slug(slug: str) -> str:
    """'fall' -> 'FALL'. Бросает ValueError на любой другой строке."""
    value = slug.strip().upper()
    if value not in SEASONS:
        raise ValueError(f"unknown season: {slug!r}")
    return value


def slug(season: str) -> str:
    return season.lower()


def label(season: str, year: int) -> str:
    return f"{SEASON_RU[season]} {year}"


def max_year(today: date) -> int:
    return today.year + MAX_YEARS_AHEAD


def year_in_range(year: int, today: date) -> bool:
    return MIN_YEAR <= year <= max_year(today)


def ttl_seconds(season: str, year: int, today: date) -> int:
    """Как долго данные сезона считаются свежими.

    Идущий и ближайший сезоны меняются каждый день (новые анонсы, статусы,
    даты серий), давно закончившиеся почти не меняются.
    """
    cur_season, cur_year = season_of(today)
    distance = (year * 4 + SEASONS.index(season)) - (cur_year * 4 + SEASONS.index(cur_season))
    if distance == 0:
        return 3 * 3600
    if distance > 0:
        return 6 * 3600 if distance <= 2 else 24 * 3600
    if distance == -1:
        return 24 * 3600
    return 14 * 24 * 3600
