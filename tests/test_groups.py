import httpx
import pytest

from app.services.groups import components, order_members, pick_root
from tests.fakes import BASE_ID

# демо-франшизы: «Хроники Морского Фонаря» (3 сезона) — BASE_ID+0..2, «Клинок бури» (3 сезона и фильм) — BASE_ID+40..43,
# «Кофейня на краю света» (один сезон) — BASE_ID+30
LANTERN = [BASE_ID, BASE_ID + 1, BASE_ID + 2]
STORM = [BASE_ID + 40, BASE_ID + 41, BASE_ID + 42, BASE_ID + 43]
CAFE = BASE_ID + 30


@pytest.fixture(autouse=True)
def own_client_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    # Счётчик лимита запросов общий на весь прогон, а test_api нарочно выбирает лимит поиска до конца.
    monkeypatch.setattr("app.ratelimit.client_ip", lambda request: "test_groups")


def test_components_follow_edges_in_any_direction():
    comps = components([1, 2, 3, 4, 9], [(1, 2), (3, 2), (4, 4)])
    assert sorted(sorted(c) for c in comps) == [[1, 2, 3], [4], [9]]


def test_components_include_nodes_that_only_appear_in_edges():
    assert [sorted(c) for c in components([], [(5, 6)])] == [[5, 6]]


def test_root_is_the_earliest_tv_series_not_the_earliest_title():
    rows = {
        1: {"format": "OVA", "start_year": 2019, "start_month": 1, "start_day": 1},
        2: {"format": "TV", "start_year": 2020, "start_month": 4, "start_day": 1},
        3: {"format": "MOVIE", "start_year": 2021, "start_month": 1, "start_day": 1},
    }
    assert order_members([3, 2, 1], rows) == [1, 2, 3]
    assert pick_root([1, 2, 3], rows) == 2


def test_root_falls_back_to_earliest_title_without_tv():
    rows = {
        1: {"format": "MOVIE", "start_year": 2022, "start_month": 1, "start_day": 1},
        2: {"format": "OVA", "start_year": 2020, "start_month": 1, "start_day": 1},
    }
    assert pick_root([1, 2], rows) == 2


def test_titles_without_date_go_last():
    rows = {1: {"format": "TV"}, 2: {"format": "TV", "start_year": 2020}}
    assert order_members([1, 2], rows) == [2, 1]


async def test_groups_endpoint_joins_watched_titles_of_one_franchise(client: httpx.AsyncClient):
    ids = [LANTERN[2], STORM[0], LANTERN[0], CAFE, STORM[3]]
    r = await client.post("/api/groups", json={"ids": ids})
    assert r.status_code == 200
    groups = r.json()["groups"]
    assert [g["seeds"] for g in groups] == [[LANTERN[2], LANTERN[0]], [STORM[0], STORM[3]]]
    first = groups[0]
    assert first["id"] == LANTERN[0] and first["title"] == "Хроники Морского Фонаря"
    assert first["total"] == 3  # вся франшиза, а не только просмотренное


async def test_groups_endpoint_skips_single_titles(client: httpx.AsyncClient):
    r = await client.post("/api/groups", json={"ids": [LANTERN[0], CAFE]})
    assert r.json() == {"groups": []}


async def test_groups_endpoint_validates_ids(client: httpx.AsyncClient):
    assert (await client.post("/api/groups", json={"ids": [-1]})).status_code == 422
    assert (await client.post("/api/groups", json={"ids": list(range(1, 502))})).status_code == 422
    assert (await client.post("/api/groups", json={"ids": []})).json() == {"groups": []}


async def test_search_returns_franchise_group_before_titles(client: httpx.AsyncClient):
    r = await client.get("/api/search", params={"q": "морского фонаря", "deep": True})
    data = r.json()
    assert data["items"]
    (group,) = [g for g in data["groups"] if g["id"] == LANTERN[0]]
    assert group["title"] == "Хроники Морского Фонаря"
    assert [m["id"] for m in group["members"]] == LANTERN  # по дате премьеры
    assert set(group["matched"]) <= set(LANTERN) and group["matched"]


async def test_search_has_no_group_for_a_standalone_title(client: httpx.AsyncClient):
    r = await client.get("/api/search", params={"q": "кофейня", "deep": True})
    data = r.json()
    assert [i["title"] for i in data["items"]] == ["Кофейня на краю света"]
    assert data["groups"] == []


async def test_search_without_results_has_empty_groups(client: httpx.AsyncClient):
    assert (await client.get("/api/search", params={"q": "к"})).json()["groups"] == []


async def test_group_includes_members_the_search_did_not_return(client: httpx.AsyncClient):
    r = await client.get("/api/search", params={"q": "клинок бури 2", "deep": True})
    data = r.json()
    group = next(g for g in data["groups"] if g["id"] == STORM[0])
    found = {i["id"] for i in data["items"]}
    assert {m["id"] for m in group["members"]} == set(STORM)
    assert found <= set(STORM)
