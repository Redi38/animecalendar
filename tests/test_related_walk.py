from datetime import date

from app.services.related import released_recently, walk


def edges(*triples):
    out: dict[int, list[tuple[int, str]]] = {}
    for src, dst, rel in triples:
        out.setdefault(src, []).append((dst, rel))
    return out


def test_chain_is_followed_through_unwatched_titles():
    # смотрел 1; 2 (продолжение) не смотрел; 3 — анонс продолжения продолжения
    hits = walk([1], edges((1, 2, "SEQUEL"), (2, 3, "SEQUEL")))
    assert set(hits) == {2, 3}
    assert hits[2].depth == 1 and hits[3].depth == 2
    assert hits[3].via == 1 and hits[3].relation == "SEQUEL"


def test_depth_is_capped():
    chain = edges((1, 2, "SEQUEL"), (2, 3, "SEQUEL"), (3, 4, "SEQUEL"), (4, 5, "SEQUEL"))
    assert set(walk([1], chain, max_depth=3)) == {2, 3, 4}


def test_watched_titles_are_not_reported():
    hits = walk([1, 2], edges((1, 2, "SEQUEL"), (2, 3, "SEQUEL")))
    assert set(hits) == {3}
    assert hits[3].via == 2


def test_adaptations_and_characters_are_ignored():
    hits = walk([1], edges((1, 2, "ADAPTATION"), (1, 3, "CHARACTER"), (1, 4, "OTHER"), (1, 5, "SOURCE")))
    assert hits == {}


def test_leaf_relations_are_found_at_any_depth_but_not_expanded():
    # альтернативная версия 2 есть у просмотренного 1, но её собственные связи не раскручиваем;
    # а вот альтернативная версия 5 у продолжения 4 найдётся
    hits = walk([1], edges((1, 2, "ALTERNATIVE"), (2, 3, "SEQUEL"), (1, 4, "SEQUEL"), (4, 5, "ALTERNATIVE")))
    assert set(hits) == {2, 4, 5}


def test_film_behind_a_long_chain_is_found_by_default():
    # просмотрен 1-й сезон; фильм связан только с 5-м сезоном через спешл и спин-офф
    chain = edges(
        (1, 2, "SEQUEL"), (2, 3, "SEQUEL"), (3, 4, "SIDE_STORY"), (4, 5, "SEQUEL"), (5, 6, "SPIN_OFF"), (6, 7, "SEQUEL")
    )
    hits = walk([1], chain)
    assert 7 in hits and hits[7].depth == 6 and hits[7].via == 1


def test_prequels_and_side_stories_are_found():
    hits = walk([2], edges((2, 1, "PREQUEL"), (2, 3, "SIDE_STORY"), (2, 4, "SPIN_OFF")))
    assert {h.relation for h in hits.values()} == {"PREQUEL", "SIDE_STORY", "SPIN_OFF"}


def test_nearest_origin_wins_and_all_origins_are_recorded():
    hits = walk([1, 3], edges((1, 2, "SEQUEL"), (2, 4, "SEQUEL"), (3, 4, "SEQUEL")))
    assert hits[4].via == 3 and hits[4].depth == 1
    assert hits[4].origins == {1, 3}


def test_cycles_do_not_hang():
    hits = walk([1], edges((1, 2, "SEQUEL"), (2, 1, "PREQUEL"), (2, 3, "SEQUEL"), (3, 2, "PREQUEL")))
    assert set(hits) == {2, 3}


def _row(status="FINISHED", y=2026, m=10, d=16):
    return {"status": status, "start_year": y, "start_month": m, "start_day": d}


def test_released_recently_covers_a_film_that_came_out_days_ago():
    today = date(2026, 10, 27)
    assert released_recently(_row(), today)  # вышел 11 дней назад
    assert not released_recently(_row(m=8, d=1), today)  # слишком давно
    assert not released_recently(_row(y=2026, m=11, d=5), today)  # ещё не вышел
    assert not released_recently(_row(status="NOT_YET_RELEASED"), today)
    assert not released_recently(_row(d=None), today)  # без точного дня не угадываем
    assert not released_recently(_row(m=2, d=31), today)  # некорректная дата не роняет запрос
