from datetime import date

import pytest

from app import seasons


@pytest.mark.parametrize(
    ("d", "expected"),
    [
        (date(2026, 1, 1), ("WINTER", 2026)),
        (date(2026, 3, 31), ("WINTER", 2026)),
        (date(2026, 4, 1), ("SPRING", 2026)),
        (date(2026, 6, 30), ("SPRING", 2026)),
        (date(2026, 7, 1), ("SUMMER", 2026)),
        (date(2026, 9, 30), ("SUMMER", 2026)),
        (date(2026, 10, 25), ("FALL", 2026)),
        (date(2026, 12, 31), ("FALL", 2026)),
    ],
)
def test_season_of(d, expected):
    assert seasons.season_of(d) == expected


@pytest.mark.parametrize(
    ("season", "year", "delta", "expected"),
    [
        ("FALL", 2026, 1, ("WINTER", 2027)),
        ("WINTER", 2027, -1, ("FALL", 2026)),
        ("SPRING", 2026, 4, ("SPRING", 2027)),
        ("SUMMER", 2026, -9, ("SPRING", 2024)),
        ("FALL", 2026, 0, ("FALL", 2026)),
    ],
)
def test_shift(season, year, delta, expected):
    assert seasons.shift(season, year, delta) == expected


def test_parse_slug():
    assert seasons.parse_slug("fall") == "FALL"
    assert seasons.parse_slug(" Winter ") == "WINTER"
    with pytest.raises(ValueError):
        seasons.parse_slug("autumn")


def test_label_is_russian():
    assert seasons.label("FALL", 2026) == "Осень 2026"
    assert seasons.label("WINTER", 2027) == "Зима 2027"


def test_year_range():
    today = date(2026, 10, 25)
    assert seasons.year_in_range(2026, today)
    assert seasons.year_in_range(2028, today)
    assert not seasons.year_in_range(2029, today)
    assert not seasons.year_in_range(1979, today)


def test_ttl_current_season_is_shortest_and_past_is_longest():
    today = date(2026, 10, 25)
    current = seasons.ttl_seconds("FALL", 2026, today)
    upcoming = seasons.ttl_seconds("WINTER", 2027, today)
    far = seasons.ttl_seconds("FALL", 2027, today)
    old = seasons.ttl_seconds("WINTER", 2020, today)
    assert current < upcoming < far
    assert old > far
