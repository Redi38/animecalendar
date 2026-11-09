"""HTTP API: сезоны, карточки, поиск, список просмотренного и связанные анонсы."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import seasons
from app.ratelimit import limiter
from app.seasons import SEASON_RU
from app.services import dto
from app.services.catalog import NotFound
from app.services.studios import MAX_PAGE

from .deps import CatalogDep, YummyDep

router = APIRouter(prefix="/api")

TitleId = Annotated[int, Field(gt=0, lt=2**31)]


class IdsBody(BaseModel):
    ids: list[TitleId] = Field(max_length=500)


def watch_template(raw: str) -> str:
    """Шаблон ссылки «Смотреть онлайн» отдаём, только если это http(s)-адрес с местом под название."""
    url = (raw or "").strip()
    ok = url.startswith(("https://", "http://")) and "{q}" in url
    return url if ok else ""


@router.get("/meta")
async def meta(request: Request, catalog: CatalogDep, yummy: YummyDep) -> dict:
    today = catalog.today()
    season, year = seasons.season_of(today)
    return {
        "current": {"season": season, "year": year},
        "min_year": seasons.MIN_YEAR,
        "max_year": seasons.max_year(today),
        "seasons": [{"code": s, "slug": seasons.slug(s), "label": SEASON_RU[s]} for s in seasons.SEASONS],
        "watch_url": request.app.state.watch_url,
        "watch_exact": yummy.enabled,
        "google_client_id": request.app.state.google_client_id,
        "google_persistent": bool(request.app.state.google_secret),
    }


@router.get("/season/{year}/{season}")
async def get_season(year: int, season: str, catalog: CatalogDep) -> dict:
    try:
        code = seasons.parse_slug(season)
    except ValueError:
        raise HTTPException(404, "Такого сезона не существует") from None
    if not seasons.year_in_range(year, catalog.today()):
        raise HTTPException(404, "Для этого года нет данных")
    rows, synced_at = await catalog.season(year, code)
    now = catalog.now()
    return {
        "year": year,
        "season": code,
        "slug": seasons.slug(code),
        "label": seasons.label(code, year),
        "synced_at": synced_at,
        "total": len(rows),
        "items": [dto.card(r, now=now) for r in rows],
    }


@router.get("/tba")
async def get_tba(catalog: CatalogDep) -> dict:
    rows, synced_at = await catalog.tba()
    now = catalog.now()
    return {"synced_at": synced_at, "total": len(rows), "items": [dto.card(r, now=now) for r in rows]}


@router.get("/title/{title_id}")
async def get_title(title_id: TitleId, catalog: CatalogDep) -> dict:
    try:
        return await catalog.detail(title_id)
    except NotFound:
        raise HTTPException(404, "Тайтл не найден") from None


@router.get("/studio/{studio_id}", dependencies=[Depends(limiter(30))])
async def get_studio(
    studio_id: TitleId, catalog: CatalogDep, page: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 1
) -> dict:
    """Тайтлы студии, где она главная, от новых к старым; page — страница по 50 штук."""
    try:
        return await catalog.studio(studio_id, page)
    except NotFound:
        raise HTTPException(404, "Студия не найдена") from None


@router.get("/title/{title_id}/watch", dependencies=[Depends(limiter(30))])
async def get_watch_page(title_id: TitleId, catalog: CatalogDep, yummy: YummyDep) -> dict:
    """Точная страница тайтла на сайте для «Смотреть онлайн»; url=null, если сайт тайтл не нашёл."""
    try:
        titles, mal_id, year = await catalog.watch_query(title_id)
    except NotFound:
        raise HTTPException(404, "Тайтл не найден") from None
    return {"url": await yummy.find_page(titles, mal_id, year)}


@router.get("/search", dependencies=[Depends(limiter(60))])
async def search(
    catalog: CatalogDep,
    q: Annotated[str, Query(max_length=100)] = "",
    deep: bool = False,
) -> dict:
    items = await catalog.search(q, deep=deep)
    # Франшизы найденного: по ним в интерфейсе сначала показывается группа, а потом отдельные тайтлы.
    groups = await catalog.search_groups([i["id"] for i in items[:10]], deep=deep) if items else []
    return {"query": q.strip(), "items": items, "groups": groups}


@router.post("/titles", dependencies=[Depends(limiter(30))])
async def titles(body: IdsBody, catalog: CatalogDep) -> dict:
    items, missing = await catalog.titles_by_ids(body.ids)
    return {"items": items, "missing": missing}


@router.post("/groups", dependencies=[Depends(limiter(30))])
async def groups(body: IdsBody, catalog: CatalogDep) -> dict:
    return {"groups": await catalog.groups(body.ids)}


@router.post("/related", dependencies=[Depends(limiter(20))])
async def related(body: IdsBody, catalog: CatalogDep) -> dict:
    return await catalog.related(body.ids)
