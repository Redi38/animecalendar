import httpx

from app.demo import BASE_ID


async def test_meta(client: httpx.AsyncClient):
    r = await client.get("/api/meta")
    assert r.status_code == 200
    data = r.json()
    assert data["current"] == {"season": "FALL", "year": 2026}
    assert [s["label"] for s in data["seasons"]] == ["Зима", "Весна", "Лето", "Осень"]
    assert data["max_year"] == 2028 and data["demo"] is True


async def test_season_returns_cards_sorted_by_popularity(client: httpx.AsyncClient):
    r = await client.get("/api/season/2026/fall")
    assert r.status_code == 200
    data = r.json()
    assert data["label"] == "Осень 2026" and data["total"] == len(data["items"]) > 10
    popularity = [i["popularity"] for i in data["items"]]
    assert popularity == sorted(popularity, reverse=True)
    first = data["items"][0]
    assert {"id", "title", "format_ru", "status_ru", "start", "start_precision", "genres"} <= set(first)


async def test_season_rejects_unknown_season_and_year_out_of_range(client: httpx.AsyncClient):
    assert (await client.get("/api/season/2026/autumn")).status_code == 404
    assert (await client.get("/api/season/2035/fall")).status_code == 404
    assert (await client.get("/api/season/1970/fall")).status_code == 404


async def test_title_detail_and_404(client: httpx.AsyncClient):
    r = await client.get(f"/api/title/{BASE_ID + 1}")
    assert r.status_code == 200
    assert r.json()["relations"]
    assert (await client.get("/api/title/987654")).status_code == 404
    assert (await client.get("/api/title/0")).status_code == 422


async def test_search_requires_two_characters(client: httpx.AsyncClient):
    assert (await client.get("/api/search", params={"q": "к"})).json()["items"] == []
    r = await client.get("/api/search", params={"q": "кофейня", "deep": True})
    assert [i["title"] for i in r.json()["items"]] == ["Кофейня на краю света"]


async def test_search_query_length_is_limited(client: httpx.AsyncClient):
    assert (await client.get("/api/search", params={"q": "я" * 101})).status_code == 422


async def test_titles_batch(client: httpx.AsyncClient):
    r = await client.post("/api/titles", json={"ids": [BASE_ID + 1, 424242]})
    assert r.status_code == 200
    data = r.json()
    assert [i["id"] for i in data["items"]] == [BASE_ID + 1]
    assert data["missing"] == [424242]


async def test_ids_validation(client: httpx.AsyncClient):
    assert (await client.post("/api/related", json={"ids": ["x"]})).status_code == 422
    assert (await client.post("/api/related", json={"ids": [-1]})).status_code == 422
    assert (await client.post("/api/related", json={"ids": list(range(1, 502))})).status_code == 422
    assert (await client.post("/api/related", json={})).status_code == 422


async def test_related_endpoint(client: httpx.AsyncClient):
    r = await client.post("/api/related", json={"ids": [BASE_ID]})
    assert r.status_code == 200
    data = r.json()
    assert [i["id"] for i in data["items"]] == [BASE_ID + 1, BASE_ID + 2]
    assert data["items"][1]["via"]["title"] == "Хроники Морского Фонаря"


async def test_anilist_outage_gives_503_with_russian_message(client: httpx.AsyncClient, anilist):
    anilist.fail = True
    r = await client.get("/api/season/2026/fall")
    assert r.status_code == 503
    assert "AniList" in r.json()["detail"]


async def test_security_headers_and_static_pages(client: httpx.AsyncClient):
    r = await client.get("/")
    assert r.status_code == 200 and "Аниме-календарь" in r.text
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"
    api = await client.get("/api/meta")
    assert api.headers["cache-control"] == "no-store"
    assert (await client.get("/static/js/main.js")).status_code == 200


async def test_rate_limit_on_search(client: httpx.AsyncClient):
    codes = [(await client.get("/api/search", params={"q": "кофейня"})).status_code for _ in range(62)]
    assert codes[0] == 200 and codes[-1] == 429
