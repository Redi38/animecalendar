"""Веб-приложение «Аниме-календарь»: FastAPI + статический фронтенд без сборки.

Запуск: `uvicorn app.web:app`. Для тестов используйте create_app() и передайте
готовый Catalog.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings, settings
from app.db import Database
from app.providers.anilist import AniListClient, AniListError
from app.providers.shikimori import ShikimoriClient
from app.providers.yummy import YummyClient
from app.services.catalog import Catalog

from .routes import router

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"

CSP = (
    "default-src 'self'; img-src 'self' data: https://s4.anilist.co https://*.anilist.co; "
    "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; "
    "font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)


def build_catalog(cfg: Settings) -> Catalog:
    if cfg.DEMO_MODE:
        from app.demo import DemoAniList, DemoShikimori

        return Catalog(
            Database(cfg.DB_PATH),
            DemoAniList(),  # type: ignore[arg-type]
            DemoShikimori(),  # type: ignore[arg-type]
            shikimori_base=cfg.SHIKIMORI_BASE,
            allow_adult=cfg.ALLOW_ADULT,
        )
    return Catalog(
        Database(cfg.DB_PATH),
        AniListClient(cfg.ANILIST_URL, cfg.HTTP_USER_AGENT, allow_adult=cfg.ALLOW_ADULT),
        ShikimoriClient(
            cfg.SHIKIMORI_BASE, cfg.HTTP_USER_AGENT, enabled=cfg.SHIKIMORI_ENABLED, allow_adult=cfg.ALLOW_ADULT
        ),
        shikimori_base=cfg.SHIKIMORI_BASE,
        allow_adult=cfg.ALLOW_ADULT,
    )


def create_app(cfg: Settings | None = None, catalog: Catalog | None = None) -> FastAPI:
    cfg = cfg or settings
    owned = catalog is None

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if owned:
            logging.basicConfig(
                level=getattr(logging, cfg.LOG_LEVEL.upper(), logging.INFO),
                format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            )
            app.state.catalog = build_catalog(cfg)
            await app.state.catalog.db.connect()
        if cfg.PREWARM:
            app.state.catalog._spawn(app.state.catalog.prewarm())
        yield
        if owned:
            cat: Catalog = app.state.catalog
            await cat.close()
            await cat.anilist.aclose()
            await cat.shikimori.aclose()
            await cat.db.close()
        await app.state.yummy.aclose()

    app = FastAPI(title="Аниме-календарь", lifespan=lifespan)
    app.state.demo = cfg.DEMO_MODE
    app.state.watch_url = cfg.WATCH_URL
    app.state.yummy = YummyClient(
        cfg.WATCH_API,
        cfg.WATCH_ITEM_URL,
        cfg.HTTP_USER_AGENT,
        token=cfg.WATCH_TOKEN,
        enabled=not cfg.DEMO_MODE,  # в демо-режиме во внешние сервисы не ходим
    )
    if catalog is not None:
        app.state.catalog = catalog

    @app.exception_handler(AniListError)
    async def _anilist_down(_: Request, exc: AniListError) -> JSONResponse:
        logger.warning("AniList: %s", exc)
        return JSONResponse(
            {"detail": "Сервис каталога (AniList) сейчас недоступен. Попробуйте чуть позже."}, status_code=503
        )

    app.include_router(router)

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict:
        return {"ok": True}

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon() -> RedirectResponse:
        return RedirectResponse("/static/favicon.svg", status_code=308)

    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.middleware("http")
    async def _headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        if not request.url.path.startswith("/api"):
            response.headers.setdefault("Content-Security-Policy", CSP)
        path = request.url.path
        if path.startswith("/static/") and "Cache-Control" not in response.headers:
            # Без хэшей в именах файлов: шрифты кэшируем надолго, остальное — с проверкой по ETag.
            if path.startswith("/static/fonts/"):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "no-cache"
        elif path.startswith("/api") and "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        return response

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


app = create_app()
