import httpx
import pytest

from app.config import Settings
from app.web import create_app
from app.web.security import build_csp, google_client_id

CLIENT_ID = "1234567890-abcdefg.apps.googleusercontent.com"


@pytest.fixture(autouse=True)
def own_client_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    # Общий счётчик лимита запросов: см. комментарий в test_groups.py
    monkeypatch.setattr("app.ratelimit.client_ip", lambda request: "test_sync_config")


def test_client_id_must_look_like_a_google_oauth_client():
    assert google_client_id(f"  {CLIENT_ID} ") == CLIENT_ID
    assert google_client_id("") == ""
    assert google_client_id("hello") == ""
    assert google_client_id("evil.com/x.apps.googleusercontent.com") == ""
    assert google_client_id("1234.apps.googleusercontent.com' onload='x") == ""


def test_csp_is_strict_without_google_and_opens_only_what_sign_in_needs_with_it():
    plain = build_csp(False)
    assert "google" not in plain and "script-src 'self';" in plain and "connect-src 'self';" in plain
    csp = build_csp(True)
    assert "script-src 'self' https://accounts.google.com/gsi/client;" in csp
    assert "https://www.googleapis.com" in csp and "frame-src https://accounts.google.com/gsi/;" in csp
    assert "default-src 'self'" in csp and "frame-ancestors 'none'" in csp


async def _client(catalog, **overrides):
    app = create_app(Settings(PREWARM=False, DEMO_MODE=True, **overrides), catalog=catalog)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_meta_hides_sync_until_a_client_id_is_configured(catalog):
    async with await _client(catalog) as c:
        assert (await c.get("/api/meta")).json()["google_client_id"] == ""
        assert "google" not in (await c.get("/")).headers["content-security-policy"]


async def test_meta_exposes_the_client_id_and_page_csp_allows_google_sign_in(catalog):
    async with await _client(catalog, GOOGLE_CLIENT_ID=CLIENT_ID) as c:
        assert (await c.get("/api/meta")).json()["google_client_id"] == CLIENT_ID
        assert "https://accounts.google.com/gsi/client" in (await c.get("/")).headers["content-security-policy"]


async def test_meta_ignores_a_malformed_client_id(catalog):
    async with await _client(catalog, GOOGLE_CLIENT_ID="not-a-client-id") as c:
        assert (await c.get("/api/meta")).json()["google_client_id"] == ""
