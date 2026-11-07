import json
from urllib.parse import parse_qs

import httpx
import pytest

from app.config import Settings
from app.web import create_app
from app.web.gauth import COOKIE, SCOPE

CLIENT_ID = "1234567890-abcdefg.apps.googleusercontent.com"
SECRET = "GOCSPX-test-secret"
HEADERS = {"X-Requested-With": "animecalendar"}


@pytest.fixture(autouse=True)
def own_client_ip(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    # Счётчик лимита запросов общий на весь процесс (см. test_groups.py), поэтому у каждого теста свой «адрес».
    ip = f"test_gauth:{request.node.name}"
    monkeypatch.setattr("app.ratelimit.client_ip", lambda req: ip)


class FakeGoogle:
    """Подставной oauth2.googleapis.com: помнит, что у него спросили."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.refresh_token: str | None = "refresh-1"
        self.scope = SCOPE
        self.revoked = False
        self.fail_with: int | None = None
        self.error = "invalid_grant"

    def handler(self, request: httpx.Request) -> httpx.Response:
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        self.calls.append((request.url.path, form))
        if request.url.path == "/revoke":
            self.revoked = True
            return httpx.Response(200)
        if self.fail_with:
            return httpx.Response(self.fail_with, json={"error": self.error})
        body = {"access_token": f"access-{len(self.calls)}", "expires_in": 3599, "scope": self.scope}
        if form["grant_type"] == "authorization_code" and self.refresh_token:
            body["refresh_token"] = self.refresh_token
        return httpx.Response(200, json=body)


async def _client(catalog, google: FakeGoogle | None = None, **overrides):
    cfg = Settings(PREWARM=False, DEMO_MODE=True, GOOGLE_CLIENT_ID=CLIENT_ID, GOOGLE_CLIENT_SECRET=SECRET, **overrides)
    app = create_app(cfg, catalog=catalog)
    if google:
        app.state.google_transport = httpx.MockTransport(google.handler)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test")


async def test_meta_announces_persistent_sign_in_only_with_a_secret(catalog):
    async with await _client(catalog) as c:
        assert (await c.get("/api/meta")).json()["google_persistent"] is True
    app = create_app(Settings(PREWARM=False, DEMO_MODE=True, GOOGLE_CLIENT_ID=CLIENT_ID), catalog=catalog)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test") as c:
        assert (await c.get("/api/meta")).json()["google_persistent"] is False
        assert (await c.post("/api/google/token", headers=HEADERS)).status_code == 404


async def test_secret_without_a_valid_client_id_is_ignored(catalog):
    app = create_app(Settings(PREWARM=False, DEMO_MODE=True, GOOGLE_CLIENT_SECRET=SECRET), catalog=catalog)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test") as c:
        assert (await c.get("/api/meta")).json()["google_persistent"] is False


async def test_requests_need_the_header_only_our_page_can_send(catalog):
    async with await _client(catalog, FakeGoogle()) as c:
        assert (await c.post("/api/google/token")).status_code == 403
        assert (await c.post("/api/google/connect", json={"code": "x"})).status_code == 403
        assert (await c.post("/api/google/token", headers={"X-Requested-With": "other"})).status_code == 403


async def test_connect_exchanges_the_code_and_keeps_the_refresh_token_in_an_encrypted_cookie(catalog):
    google = FakeGoogle()
    async with await _client(catalog, google) as c:
        res = await c.post("/api/google/connect", json={"code": "the-code"}, headers=HEADERS)
        assert res.status_code == 200
        body = res.json()
        assert body["persistent"] is True and body["access_token"] and body["expires_in"] == 3599
        assert "refresh" not in json.dumps(body), "refresh-токен браузеру не отдаём"
        path, form = google.calls[0]
        assert path == "/token" and form["code"] == "the-code" and form["client_secret"] == SECRET
        assert form["redirect_uri"] == "postmessage" and form["client_id"] == CLIENT_ID
        cookie = res.headers["set-cookie"]
        assert cookie.startswith(f"{COOKIE}=") and "HttpOnly" in cookie and "Secure" in cookie
        assert "SameSite=lax" in cookie and "Path=/api/google" in cookie and "Max-Age=" in cookie
        assert "refresh-1" not in cookie, "в куке токен только зашифрованным"


async def test_token_endpoint_issues_fresh_access_tokens_from_the_cookie(catalog):
    google = FakeGoogle()
    async with await _client(catalog, google) as c:
        await c.post("/api/google/connect", json={"code": "x"}, headers=HEADERS)
        res = await c.post("/api/google/token", headers=HEADERS)
        assert res.status_code == 200 and res.json()["access_token"] and "persistent" not in res.json()
        path, form = google.calls[-1]
        assert path == "/token" and form["grant_type"] == "refresh_token" and form["refresh_token"] == "refresh-1"


async def test_token_without_a_cookie_or_with_a_forged_one_means_sign_in_again(catalog):
    google = FakeGoogle()
    async with await _client(catalog, google) as c:
        assert (await c.post("/api/google/token", headers=HEADERS)).status_code == 401
        c.cookies.set(COOKIE, "not-a-real-token", path="/api/google")
        assert (await c.post("/api/google/token", headers=HEADERS)).status_code == 401
    assert google.calls == [], "до Google такие запросы не доходят"


async def test_a_cookie_made_with_another_secret_is_rejected(catalog):
    google = FakeGoogle()
    async with await _client(catalog, google) as c:
        await c.post("/api/google/connect", json={"code": "x"}, headers=HEADERS)
        stolen = c.cookies.get(COOKIE)
    cfg = Settings(PREWARM=False, DEMO_MODE=True, GOOGLE_CLIENT_ID=CLIENT_ID, GOOGLE_CLIENT_SECRET="another-secret")
    app = create_app(cfg, catalog=catalog)
    app.state.google_transport = httpx.MockTransport(google.handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://test") as c2:
        c2.cookies.set(COOKIE, stolen, path="/api/google")
        assert (await c2.post("/api/google/token", headers=HEADERS)).status_code == 401


async def test_revoked_access_clears_the_cookie_but_a_google_outage_does_not(catalog):
    google = FakeGoogle()
    async with await _client(catalog, google) as c:
        await c.post("/api/google/connect", json={"code": "x"}, headers=HEADERS)
        google.fail_with, google.error = 503, "backend_error"
        assert (await c.post("/api/google/token", headers=HEADERS)).status_code == 502
        assert c.cookies.get(COOKIE), "из-за сбоя Google куку не стираем"
        google.fail_with, google.error = 400, "invalid_grant"
        res = await c.post("/api/google/token", headers=HEADERS)
        assert res.status_code == 401 and not c.cookies.get(COOKIE)


async def test_connect_rejects_a_refused_code_and_a_missing_drive_permission(catalog):
    google = FakeGoogle()
    async with await _client(catalog, google) as c:
        google.fail_with = 400
        assert (await c.post("/api/google/connect", json={"code": "bad"}, headers=HEADERS)).status_code == 400
        google.fail_with, google.scope = None, "openid"
        res = await c.post("/api/google/connect", json={"code": "x"}, headers=HEADERS)
        assert res.status_code == 400 and not c.cookies.get(COOKIE)
        assert (await c.post("/api/google/connect", json={}, headers=HEADERS)).status_code == 422


async def test_repeat_consent_without_a_new_refresh_token_keeps_the_existing_cookie(catalog):
    google = FakeGoogle()
    async with await _client(catalog, google) as c:
        await c.post("/api/google/connect", json={"code": "x"}, headers=HEADERS)
        google.refresh_token = None  # Google выдаёт refresh-токен только при первом согласии
        res = await c.post("/api/google/connect", json={"code": "y"}, headers=HEADERS)
        assert res.json()["persistent"] is True
    async with await _client(catalog, google) as fresh:
        res = await fresh.post("/api/google/connect", json={"code": "z"}, headers=HEADERS)
        assert res.status_code == 200 and res.json()["persistent"] is False and "set-cookie" not in res.headers


async def test_disconnect_revokes_at_google_and_clears_the_cookie(catalog):
    google = FakeGoogle()
    async with await _client(catalog, google) as c:
        await c.post("/api/google/connect", json={"code": "x"}, headers=HEADERS)
        res = await c.post("/api/google/disconnect", headers=HEADERS)
        assert res.status_code == 204 and google.revoked and not c.cookies.get(COOKIE)
        assert google.calls[-1] == ("/revoke", {"token": "refresh-1"})


async def test_cookie_is_not_marked_secure_over_plain_http(catalog):
    google = FakeGoogle()
    cfg = Settings(PREWARM=False, DEMO_MODE=True, GOOGLE_CLIENT_ID=CLIENT_ID, GOOGLE_CLIENT_SECRET=SECRET)
    app = create_app(cfg, catalog=catalog)
    app.state.google_transport = httpx.MockTransport(google.handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        res = await c.post("/api/google/connect", json={"code": "x"}, headers=HEADERS)
        assert "Secure" not in res.headers["set-cookie"]
