import httpx

from app.providers.yummy import YummyClient, norm, pick

ITEM = "https://site.test/catalog/item/{slug}"


def make(handler, **kw) -> YummyClient:
    return YummyClient(
        "https://site.test/api", ITEM, "test", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), **kw
    )


def search_result(*cands):
    return httpx.Response(200, json={"response": list(cands)})


def test_norm_ignores_case_yo_and_punctuation():
    assert norm("Токийские мстители!") == norm("токийские  мстители")
    assert norm("Ёжик") == norm("ежик")


def test_pick_prefers_matching_remote_id_over_title():
    cands = [
        {"anime_url": "wrong-same-title", "title": "Блич", "year": 2004},
        {"anime_url": "right-by-id", "title": "Совсем другое имя", "remote_ids": {"shikimori_id": 269}},
    ]
    assert pick(cands, ["Блич"], 269, 2004) == "right-by-id"


def test_pick_matches_title_and_year_and_rejects_other_years():
    cands = [
        {"anime_url": "bleach-2", "title": "Блич", "year": 2022},
        {"anime_url": "bleach", "title": "Блич", "year": 2004},
    ]
    assert pick(cands, ["Блич"], None, 2004) == "bleach"
    assert pick(cands[:1], ["Блич"], None, 2004) is None


def test_pick_skips_unsafe_slugs_and_unknown_titles():
    assert pick([{"anime_url": "../evil", "title": "Блич"}], ["Блич"], None, None) is None
    assert pick([{"anime_url": "ok-slug", "title": "Другое"}], ["Блич"], None, None) is None


async def test_find_page_builds_url_and_caches():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return search_result({"anime_url": "tokiyskie-mstiteli-4", "title": "Токийские мстители", "year": 2026})

    yummy = make(handler)
    url = await yummy.find_page(["Токийские мстители"], None, 2026)
    assert url == "https://site.test/catalog/item/tokiyskie-mstiteli-4"
    assert await yummy.find_page(["Токийские мстители"], None, 2026) == url
    assert len(calls) == 1


async def test_find_page_returns_none_and_does_not_cache_network_errors():
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(500)
        return search_result({"anime_url": "x", "title": "Блич", "year": 2004})

    yummy = make(handler)
    assert await yummy.find_page(["Блич"], None, 2004) is None
    assert await yummy.find_page(["Блич"], None, 2004) == "https://site.test/catalog/item/x"


async def test_disabled_client_makes_no_requests():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("не должно быть запросов")

    assert await make(handler, enabled=False).find_page(["Блич"], None, None) is None
