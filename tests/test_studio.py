"""Страница студии: тайтлы от новых к старым, кэш на неделю, постраничная загрузка."""

import httpx
import pytest

from app.json_util import dumps, loads_studios
from app.providers.anilist import parse_list_nodes
from app.services.studios import STUDIO_TTL
from tests.conftest import Clock, CountingAniList
from tests.fakes import BASE_ID, FRANCHISES, studio_id

KOJITSU = studio_id("Studio Kōjitsu")


@pytest.fixture(autouse=True)
def own_client_ip(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    ip = f"test_studio:{request.node.name}"
    monkeypatch.setattr("app.ratelimit.client_ip", lambda req: ip)


def kojitsu_titles() -> int:
    return sum(len(f[7]) for f in FRANCHISES if f[5] == "Studio Kōjitsu")


async def test_studio_page_lists_titles_newest_first(client: httpx.AsyncClient):
    r = await client.get(f"/api/studio/{KOJITSU}")
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Studio Kōjitsu" and data["id"] == KOJITSU
    assert data["page"] == 1 and data["has_next"] is False
    assert len(data["items"]) == kojitsu_titles()
    starts = [i["start"] for i in data["items"]]
    assert starts == sorted(starts, reverse=True)
    assert all({"id", "title", "cover", "format_ru", "start"} <= set(i) for i in data["items"])


async def test_studio_titles_are_the_studios_own_only(client: httpx.AsyncClient):
    ids = {i["id"] for i in (await client.get(f"/api/studio/{KOJITSU}")).json()["items"]}
    other = {i["id"] for i in (await client.get(f"/api/studio/{studio_id('Studio Mugi')}")).json()["items"]}
    assert ids and other and not ids & other


async def test_pagination_walks_all_pages_without_duplicates(client: httpx.AsyncClient, anilist: CountingAniList):
    anilist.studio_page_size = 3
    seen: list[int] = []
    page = 1
    while True:
        data = (await client.get(f"/api/studio/{KOJITSU}?page={page}")).json()
        assert len(data["items"]) <= 3
        seen += [i["id"] for i in data["items"]]
        if not data["has_next"]:
            break
        page += 1
    assert len(seen) == len(set(seen)) == kojitsu_titles()
    assert page == -(-kojitsu_titles() // 3)


async def test_pages_are_cached_for_a_week_then_refetched(
    client: httpx.AsyncClient, anilist: CountingAniList, clock: Clock
):
    await client.get(f"/api/studio/{KOJITSU}")
    await client.get(f"/api/studio/{KOJITSU}")
    assert anilist.studio_calls == [(KOJITSU, 1)]
    clock.advance(STUDIO_TTL - 60)
    await client.get(f"/api/studio/{KOJITSU}")
    assert len(anilist.studio_calls) == 1
    clock.advance(120)
    await client.get(f"/api/studio/{KOJITSU}")
    assert len(anilist.studio_calls) == 2


async def test_stale_copy_is_shown_when_anilist_is_down(
    client: httpx.AsyncClient, anilist: CountingAniList, clock: Clock
):
    first = (await client.get(f"/api/studio/{KOJITSU}")).json()
    clock.advance(STUDIO_TTL + 1)
    anilist.studio_down = True
    again = await client.get(f"/api/studio/{KOJITSU}")
    assert again.status_code == 200 and again.json()["items"] == first["items"]
    # страницы, которой у нас ещё не было, без AniList не показать
    anilist.studio_down = True
    assert (await client.get(f"/api/studio/{studio_id('Studio Mugi')}")).status_code == 503


async def test_unknown_studio_is_404_and_bad_input_is_rejected(client: httpx.AsyncClient):
    assert (await client.get("/api/studio/999999")).status_code == 404
    assert (await client.get("/api/studio/0")).status_code == 422
    assert (await client.get("/api/studio/abc")).status_code == 422
    assert (await client.get(f"/api/studio/{KOJITSU}?page=0")).status_code == 422
    assert (await client.get(f"/api/studio/{KOJITSU}?page=41")).status_code == 422


async def test_list_titles_become_full_cards_when_opened(client: httpx.AsyncClient):
    first = (await client.get(f"/api/studio/{KOJITSU}")).json()["items"][0]
    assert first["partial"] is True
    detail = (await client.get(f"/api/title/{first['id']}")).json()
    assert detail["partial"] is False
    assert detail["studios"] == [{"id": KOJITSU, "name": "Studio Kōjitsu"}]


async def test_music_and_adult_titles_are_skipped_unless_allowed():
    nodes = [
        {"id": 1, "type": "ANIME", "format": "TV", "isAdult": False, "title": {}},
        {"id": 2, "type": "ANIME", "format": "MUSIC", "isAdult": False, "title": {}},
        {"id": 3, "type": "ANIME", "format": "OVA", "isAdult": True, "title": {}},
        {"id": 4, "type": "MANGA", "format": "MANGA", "isAdult": False, "title": {}},
        None,
        {"type": "ANIME", "format": "TV", "title": {}},
    ]
    assert [r["id"] for r in parse_list_nodes(nodes)] == [1]
    assert [r["id"] for r in parse_list_nodes(nodes, allow_adult=True)] == [1, 3]
    assert all(r["partial"] == 1 for r in parse_list_nodes(nodes))


async def test_old_cards_with_studio_names_only_get_ids_on_first_open(
    client: httpx.AsyncClient, catalog, anilist: CountingAniList
):
    title_id = BASE_ID
    await client.get(f"/api/title/{title_id}")
    # запись, сохранённая до появления ID студий: список названий
    await catalog.db.conn.execute("UPDATE titles SET studios = ? WHERE id = ?", (dumps(["Studio Kōjitsu"]), title_id))
    await catalog.db.conn.commit()
    before = anilist.count("by_ids")
    detail = (await client.get(f"/api/title/{title_id}")).json()
    assert detail["studios"] == [{"id": KOJITSU, "name": "Studio Kōjitsu"}]
    assert anilist.count("by_ids") == before + 1
    await client.get(f"/api/title/{title_id}")
    assert anilist.count("by_ids") == before + 1, "после обновления повторно не запрашиваем"


async def test_old_cards_still_open_when_anilist_is_down(client: httpx.AsyncClient, catalog, anilist: CountingAniList):
    await client.get(f"/api/title/{BASE_ID}")
    await catalog.db.conn.execute("UPDATE titles SET studios = ? WHERE id = ?", (dumps(["Studio Kōjitsu"]), BASE_ID))
    await catalog.db.conn.commit()
    anilist.fail = True
    detail = (await client.get(f"/api/title/{BASE_ID}")).json()
    assert detail["studios"] == [{"id": None, "name": "Studio Kōjitsu"}]


def test_studios_are_read_in_both_storage_formats():
    assert loads_studios(None) == [] and loads_studios("not json") == [] and loads_studios("{}") == []
    assert loads_studios(dumps(["A", "B"])) == [{"id": None, "name": "A"}, {"id": None, "name": "B"}]
    assert loads_studios(dumps([{"id": 5, "name": "A"}, {"name": "B"}, {"id": "x", "name": "C"}, {"id": 1}, 7])) == [
        {"id": 5, "name": "A"},
        {"id": None, "name": "B"},
        {"id": None, "name": "C"},
    ]
