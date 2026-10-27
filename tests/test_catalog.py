import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.demo import BASE_ID, MAL_OFFSET
from app.providers.anilist import AniListError
from app.services.catalog import RELATIONS_TTL_ACTIVE, Catalog, NotFound

LANTERN = [BASE_ID + 0, BASE_ID + 1, BASE_ID + 2]  # 2025 осень, 2026 осень, 2027 весна


async def test_first_season_request_fetches_stores_and_translates(catalog: Catalog, anilist, shikimori):
    rows, synced = await catalog.season(2026, "FALL")
    assert synced is not None
    assert len(rows) > 10
    assert anilist.count("season_page") == 1
    await catalog.drain()
    rows, _ = await catalog.season(2026, "FALL")
    assert all(r["title_ru"] for r in rows), "русские названия подтянулись из Shikimori"


async def test_fresh_season_is_served_from_cache(catalog: Catalog, anilist):
    await catalog.season(2026, "FALL")
    await catalog.season(2026, "FALL")
    assert anilist.count("season_page") == 1


async def test_concurrent_first_requests_share_one_fetch(catalog: Catalog, anilist):
    await asyncio.gather(*(catalog.season(2026, "FALL") for _ in range(5)))
    assert anilist.count("season_page") == 1


async def test_stale_season_is_served_immediately_and_refreshed_in_background(catalog: Catalog, anilist, clock):
    await catalog.season(2026, "FALL")
    clock.advance(4 * 3600)  # TTL текущего сезона — 3 часа
    rows, _ = await catalog.season(2026, "FALL")
    assert rows, "устаревшие данные отдаются сразу"
    await catalog.drain()
    assert anilist.count("season_page") == 2


async def test_failed_refresh_keeps_old_data(catalog: Catalog, anilist, clock):
    await catalog.season(2026, "FALL")
    anilist.fail = True
    clock.advance(4 * 3600)
    rows, _ = await catalog.season(2026, "FALL")
    await catalog.drain()
    assert rows


async def test_first_request_fails_loudly_when_anilist_is_down(catalog: Catalog, anilist):
    anilist.fail = True
    with pytest.raises(AniListError):
        await catalog.season(2026, "FALL")
    anilist.fail = False
    rows, _ = await catalog.season(2026, "FALL")  # после сбоя следующая попытка работает
    assert rows


async def test_season_is_a_calendar_slice_not_a_mix(catalog: Catalog):
    rows, _ = await catalog.season(2027, "WINTER")
    assert rows and all(r["season"] == "WINTER" and r["season_year"] == 2027 for r in rows)


async def test_title_that_moves_to_another_season_is_released(catalog: Catalog, db, anilist):
    await catalog.season(2026, "FALL")
    moved = BASE_ID + 3 * 10  # «Кофейня на краю света»
    anilist.data.entries[moved]["season"] = "WINTER"
    anilist.data.entries[moved]["year"] = 2027
    catalog._clock.advance(4 * 3600)  # type: ignore[attr-defined]
    await catalog.season(2026, "FALL")
    await catalog.drain()
    rows = await db.season_titles("FALL", 2026)
    assert moved not in {r["id"] for r in rows}


async def test_search_finds_russian_names_regardless_of_yo_and_case(catalog: Catalog):
    await catalog.season(2026, "FALL")
    await catalog.drain()
    found = await catalog.search("КОФЕЙНЯ  краю")
    assert [c["title"] for c in found] == ["Кофейня на краю света"]


async def test_search_uses_all_words_in_any_order(catalog: Catalog):
    await catalog.season(2026, "FALL")
    await catalog.drain()
    assert await catalog.search("света кофейня")
    assert await catalog.search("кофейня луна") == []


async def test_search_ranks_prefix_before_substring(catalog: Catalog):
    await catalog.season(2026, "FALL")
    await catalog.drain()
    names = [c["title"] for c in await catalog.search("часов")]
    assert names == [] or "Часов" in names[0]  # «Академия Серебряных Часов» только в другом сезоне


async def test_search_ignores_one_letter_queries(catalog: Catalog, anilist):
    assert await catalog.search("а") == []
    assert anilist.calls == []


async def test_cyrillic_search_goes_through_shikimori_and_maps_back_to_anilist(catalog: Catalog, shikimori, anilist):
    # в БД ещё ничего нет: найти можно только через внешний поиск
    found = await catalog.search("рейс лун", deep=True)  # основа слова — как вводят по мере набора
    assert [c["title"] for c in found] == ["Последний рейс на Луну", "Последний рейс на Луну: Фильм"]
    assert "search" in shikimori.calls
    assert anilist.count("by_mal_ids") == 1


async def test_latin_search_goes_through_anilist(catalog: Catalog, anilist):
    found = await catalog.search("Gardener", deep=True)
    assert [c["title"] for c in found] == ["Робот-садовник"]  # русское название подтянулось
    assert anilist.count("search") == 1


async def test_remote_search_results_are_cached(catalog: Catalog, anilist):
    await catalog.search("Gardener", deep=True)
    await catalog.search("gardener", deep=True)
    assert anilist.count("search") == 1


async def test_search_survives_anilist_outage(catalog: Catalog, anilist):
    await catalog.season(2026, "FALL")
    await catalog.drain()
    anilist.fail = True
    assert await catalog.search("кофейня", deep=True)  # локальные результаты на месте


async def test_titles_by_ids_fetches_missing_and_reports_unknown(catalog: Catalog):
    cards, missing = await catalog.titles_by_ids([LANTERN[1], 424242, LANTERN[1]])
    assert [c["id"] for c in cards] == [LANTERN[1]]
    assert missing == [424242]
    assert cards[0]["title"] == "Хроники Морского Фонаря 2"


async def test_titles_by_ids_degrades_when_anilist_is_down(catalog: Catalog, anilist):
    anilist.fail = True
    cards, missing = await catalog.titles_by_ids([LANTERN[1]])
    assert cards == [] and missing == [LANTERN[1]]


async def test_detail_adds_russian_description_once(catalog: Catalog, shikimori):
    first = await catalog.detail(LANTERN[1])
    assert first["description_lang"] == "ru"
    assert "Демо-данные" in first["description"]
    await catalog.detail(LANTERN[1])
    assert shikimori.calls.count("description") == 1


async def test_detail_falls_back_to_english_description(catalog: Catalog, shikimori):
    shikimori.enabled = False
    d = await catalog.detail(LANTERN[1])
    assert d["description_lang"] == "en"


async def test_detail_lists_relations_with_russian_labels(catalog: Catalog):
    d = await catalog.detail(LANTERN[1])
    assert [(r["id"], r["relation_ru"]) for r in d["relations"]] == [
        (LANTERN[0], "Предыстория"),
        (LANTERN[2], "Продолжение"),
    ]
    assert d["links"]["anilist"].endswith(f"/anime/{LANTERN[1]}")
    assert d["links"]["mal"].endswith(f"/anime/{LANTERN[1] + MAL_OFFSET}")


async def test_detail_unknown_title(catalog: Catalog):
    with pytest.raises(NotFound):
        await catalog.detail(999999)


async def test_related_finds_announced_sequels_through_a_chain(catalog: Catalog):
    # смотрел только первый сезон — второй уже выходит, третий анонсирован через цепочку
    result = await catalog.related([LANTERN[0]])
    got = {i["id"]: i for i in result["items"]}
    assert set(got) == {LANTERN[1], LANTERN[2]}
    assert got[LANTERN[1]]["status"] == "RELEASING"
    assert got[LANTERN[2]]["status"] == "NOT_YET_RELEASED"
    assert got[LANTERN[2]]["via"]["id"] == LANTERN[0]
    assert got[LANTERN[2]]["depth"] == 2
    assert got[LANTERN[2]]["relation_ru"] == "Продолжение"
    assert result["degraded"] is False
    assert {i["id"] for i in result["items"]} <= set(result["linked"])
    assert LANTERN[0] not in result["linked"]


async def test_related_skips_finished_titles_and_what_is_already_watched(catalog: Catalog):
    result = await catalog.related([LANTERN[0], LANTERN[1]])
    assert [i["id"] for i in result["items"]] == [LANTERN[2]]


async def test_related_is_sorted_by_premiere_date(catalog: Catalog):
    clockwork = BASE_ID + 10  # Академия Серебряных Часов: сезон 2 — зима 2027
    stormblade = BASE_ID + 40  # Клинок бури
    result = await catalog.related([LANTERN[0], clockwork, stormblade])
    starts = [i["start"] for i in result["items"]]
    keys = [s or "9999" for s in starts]
    assert keys == sorted(keys)


async def test_related_reuses_cache_between_calls(catalog: Catalog, anilist):
    await catalog.related([LANTERN[0]])
    before = len(anilist.calls)
    await catalog.related([LANTERN[0]])
    assert len(anilist.calls) == before


async def test_related_refreshes_stale_relations(catalog: Catalog, anilist, clock):
    await catalog.related([LANTERN[0]])
    before = len(anilist.calls)
    clock.advance(RELATIONS_TTL_ACTIVE + 60)
    await catalog.related([LANTERN[0]])
    assert len(anilist.calls) > before


async def test_related_reports_degraded_mode_but_still_answers(catalog: Catalog, anilist):
    await catalog.related([LANTERN[0]])  # данные осели в кэше
    anilist.fail = True
    catalog._clock.advance(RELATIONS_TTL_ACTIVE + 60)  # type: ignore[attr-defined]
    result = await catalog.related([LANTERN[0]])
    assert result["degraded"] is True
    assert {i["id"] for i in result["items"]} == {LANTERN[1], LANTERN[2]}


async def test_related_with_nothing_watched(catalog: Catalog):
    assert (await catalog.related([]))["items"] == []


async def test_related_ignores_unknown_ids(catalog: Catalog):
    result = await catalog.related([987654])
    assert result["items"] == []


async def test_search_matches_other_grammatical_forms(catalog: Catalog):
    await catalog.season(2026, "SUMMER")
    await catalog.drain()
    # «Последний рейс на Луну» — ищем по начальной форме «луна»
    found = [c["title"] for c in await catalog.search("луна")]
    assert found[0] == "Последний рейс на Луну"


async def test_tba_lists_undated_announcements_and_is_cached(catalog: Catalog, anilist):
    rows, synced = await catalog.tba()
    assert synced is not None and len(rows) == 2
    assert all(r["season_year"] is None and r["start_year"] is None for r in rows)
    assert [r["popularity"] for r in rows] == sorted((r["popularity"] for r in rows), reverse=True)
    await catalog.tba()
    assert anilist.count("tba_page") == 1


async def test_stale_tba_is_refreshed_in_background(catalog: Catalog, anilist, clock):
    await catalog.tba()
    clock.advance(7 * 3600)  # TTL анонсов без даты — 6 часов
    rows, _ = await catalog.tba()
    assert len(rows) == 2, "устаревший список отдаётся сразу"
    await catalog.drain()
    assert anilist.count("tba_page") == 2


async def test_related_reports_incomplete_when_budget_runs_out_and_converges(catalog: Catalog, monkeypatch):
    full = await catalog.related([LANTERN[0]])  # эталон: без ограничения бюджета
    assert full["incomplete"] is False

    monkeypatch.setattr("app.services.catalog.FETCH_BUDGET", 1)
    # свежая БД, чтобы ничего не осталось в кэше от эталонного вызова
    await catalog.db.conn.execute("UPDATE titles SET relations_synced_at = NULL")
    await catalog.db.conn.commit()

    result = await catalog.related([LANTERN[0]])
    assert result["incomplete"] is True

    for _ in range(30):
        if not result["incomplete"]:
            break
        result = await catalog.related([LANTERN[0]])
    assert result["incomplete"] is False
    assert [i["id"] for i in result["items"]] == [i["id"] for i in full["items"]]


async def test_related_shows_a_title_that_came_out_a_few_days_ago(catalog: Catalog):
    await catalog.related([LANTERN[0]])
    today = datetime.fromtimestamp(catalog.now(), UTC).date() - timedelta(days=5)
    await catalog.db.conn.execute(
        "UPDATE titles SET status = 'FINISHED', start_year = ?, start_month = ?, start_day = ?, synced_at = ? WHERE id = ?",
        (today.year, today.month, today.day, catalog.now(), LANTERN[2]),
    )
    await catalog.db.conn.commit()
    result = await catalog.related([LANTERN[0]])
    got = {i["id"]: i for i in result["items"]}
    assert LANTERN[2] in got and got[LANTERN[2]]["status"] == "FINISHED"
