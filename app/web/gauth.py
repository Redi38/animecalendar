"""Постоянный вход в Google для синхронизации списка.

Браузерный вход Google даёт токен всего на час. Чтобы не входить каждый час, сервер меняет одноразовый код на
refresh-токен и кладёт его в зашифрованную HttpOnly-куку этого браузера. Сервер сам ничего не хранит: ни базы
пользователей, ни токенов. По запросу браузера он выпускает свежий access-токен, а с Диском браузер работает напрямую.

Включается, когда заданы и GOOGLE_CLIENT_ID, и GOOGLE_CLIENT_SECRET.
"""

from __future__ import annotations

import base64
import hashlib
import logging
from typing import Any

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.ratelimit import limiter

logger = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
SCOPE = "https://www.googleapis.com/auth/drive.appdata"
COOKIE = "gsync"
COOKIE_PATH = "/api/google"
COOKIE_MAX_AGE = 400 * 24 * 3600  # больше браузеры всё равно не хранят
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "animecalendar"


def make_fernet(client_secret: str) -> Fernet:
    """Ключ шифрования куки выводится из секрета клиента: отдельная настройка не нужна."""
    digest = hashlib.sha256(b"animecalendar-gsync-v1:" + client_secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def enabled(request: Request) -> bool:
    return bool(request.app.state.google_client_id and request.app.state.google_secret)


def guard(request: Request) -> None:
    """Эндпоинты работают только при настроенном секрете и только на запросы нашей страницы.

    Заголовок X-Requested-With чужая страница отправить не может без разрешения CORS, которого у нас нет.
    """
    if not enabled(request):
        raise HTTPException(404, "Постоянный вход не настроен.")
    if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise HTTPException(403, "Запрос не с нашей страницы.")


router = APIRouter(prefix="/api/google", dependencies=[Depends(limiter(20)), Depends(guard)])


class CodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=2048)


async def _google(request: Request, url: str, data: dict[str, str]) -> httpx.Response:
    try:
        async with httpx.AsyncClient(transport=request.app.state.google_transport, timeout=10) as client:
            return await client.post(url, data=data)
    except httpx.HTTPError as e:
        logger.warning("google oauth: %s", e)
        raise HTTPException(502, "Google сейчас недоступен. Попробуйте позже.") from None


def _secure(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    return bool(request.app.state.trust_proxy and request.headers.get("x-forwarded-proto") == "https")


def _set_cookie(request: Request, response: Response, refresh: str) -> None:
    value = request.app.state.google_fernet.encrypt(refresh.encode()).decode()
    response.set_cookie(
        COOKIE,
        value,
        max_age=COOKIE_MAX_AGE,
        path=COOKIE_PATH,
        httponly=True,
        secure=_secure(request),
        samesite="lax",
    )


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE, path=COOKIE_PATH)


def _refresh_from_cookie(request: Request) -> str | None:
    raw = request.cookies.get(COOKIE)
    if not raw:
        return None
    try:
        return request.app.state.google_fernet.decrypt(raw.encode()).decode()
    except InvalidToken:
        return None


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _access(data: dict[str, Any]) -> tuple[str, int]:
    token = data.get("access_token")
    if not isinstance(token, str) or not token:
        raise HTTPException(502, "Google вернул неожиданный ответ.")
    expires = data.get("expires_in")
    return token, int(expires) if isinstance(expires, int | float) and expires > 0 else 3600


@router.post("/connect")
async def connect(body: CodeIn, request: Request) -> JSONResponse:
    """Меняет код из окна входа на токены. Refresh-токен уходит в куку, браузеру отдаём только access-токен."""
    state = request.app.state
    res = await _google(
        request,
        TOKEN_URL,
        {
            "code": body.code,
            "client_id": state.google_client_id,
            "client_secret": state.google_secret,
            "redirect_uri": "postmessage",
            "grant_type": "authorization_code",
        },
    )
    data = _json(res)
    if res.status_code != 200:
        logger.warning("google oauth: код не принят (%s %s)", res.status_code, data.get("error"))
        raise HTTPException(400, "Google не принял вход. Попробуйте ещё раз.")
    if SCOPE not in str(data.get("scope", "")).split():
        raise HTTPException(400, "Не дан доступ к папке приложения на Google Диске.")
    token, expires = _access(data)
    refresh = data.get("refresh_token")
    persistent = isinstance(refresh, str) and bool(refresh)
    response = JSONResponse({"access_token": token, "expires_in": expires, "persistent": persistent})
    if persistent:
        _set_cookie(request, response, str(refresh))
    else:
        # Google выдаёт refresh-токен только при первом согласии. Если кука с прошлого раза ещё жива, она работает.
        persistent = _refresh_from_cookie(request) is not None
        response = JSONResponse({"access_token": token, "expires_in": expires, "persistent": persistent})
    return response


@router.post("/token")
async def token(request: Request) -> JSONResponse:
    """Свежий access-токен по куке. 401: куки нет или доступ отозван, нужно войти заново."""
    refresh = _refresh_from_cookie(request)
    if refresh is None:
        response = JSONResponse({"detail": "Нужно войти в Google заново."}, status_code=401)
        _clear_cookie(response)
        return response
    state = request.app.state
    res = await _google(
        request,
        TOKEN_URL,
        {
            "refresh_token": refresh,
            "client_id": state.google_client_id,
            "client_secret": state.google_secret,
            "grant_type": "refresh_token",
        },
    )
    data = _json(res)
    if res.status_code != 200:
        if data.get("error") == "invalid_grant":  # доступ отозван в настройках Google или токен устарел
            response = JSONResponse({"detail": "Нужно войти в Google заново."}, status_code=401)
            _clear_cookie(response)
            return response
        logger.warning("google oauth: обновить токен не вышло (%s %s)", res.status_code, data.get("error"))
        raise HTTPException(502, "Google сейчас недоступен. Попробуйте позже.")
    access, expires = _access(data)
    return JSONResponse({"access_token": access, "expires_in": expires})


@router.post("/disconnect")
async def disconnect(request: Request) -> Response:
    """Отзывает доступ у Google и стирает куку (файл на Диске остаётся)."""
    refresh = _refresh_from_cookie(request)
    if refresh is not None:
        try:
            await _google(request, REVOKE_URL, {"token": refresh})
        except HTTPException:
            pass  # отзыв необязателен: куку мы всё равно стираем
    response = Response(status_code=204)
    _clear_cookie(response)
    return response
