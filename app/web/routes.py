"""HTTP API: сезоны, карточки, поиск, список просмотренного и связанные анонсы."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import seasons
from app.ratelimit import limiter
from app.seasons import SEASON_RU
from app.services.catalog import Catalog, NotFound

router = APIRouter(prefix="/api")

TitleId = Annotated[int, Field(gt=0, lt=2**31)]


class IdsBody(BaseModel):
    ids: list[TitleId] = Field(max_length=500)


def catalog_of(request: Request) -> Catalog:
    return request.app.state.catalog


CatalogDep = Annotated[Catalog, Depends(catalog_of)]


def watch_template(raw: str) -> str:
    """Шаблон ссылки «Смотреть онлайн» отдаём, только если это http(s)-адрес с местом под название."""
    url = (raw or "").strip()
    ok = url.startswith(("https://", "http://")) and "{q}" in url
    return url if ok else ""


@router.get("/meta")
async def meta(request: Request, catalog: CatalogDep) -> dict:
    today = catalog.today()
    season, year = seasons.season_of(today)
    return {
        "current": {"season": season, "year": year},
        "min_year": seasons.MIN_YEAR,
        "max_year": seasons.max_year(today),
        "seasons": [{"code": s, "slug": seasons.slug(s), "label": SEASON_RU[s]} for s in seasons.SEASONS],
        "demo": bool(request.app.state.demo),
        "watch_url": watch_template(request.app.state.watch_url),
        "watch_exact": request.app.state.yummy.enabled,
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
    from app.services import dto

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
    from app.services import dto

    return {"synced_at": synced_at, "total": len(rows), "items": [dto.card(r, now=now) for r in rows]}


@router.get("/title/{title_id}")
async def get_title(title_id: TitleId, catalog: CatalogDep) -> dict:
    try:
        return await catalog.detail(title_id)
    except NotFound:
        raise HTTPException(404, "Тайтл не найден") from None


@router.get("/title/{title_id}/watch", dependencies=[Depends(limiter(30))])
async def get_watch_page(title_id: TitleId, request: Request, catalog: CatalogDep) -> dict:
    """Точная страница тайтла на сайте для «Смотреть онлайн»; url=null, если сайт тайтл не нашёл."""
    row = (await catalog.db.get_titles([title_id])).get(title_id)
    if row is None:
        raise HTTPException(404, "Тайтл не найден")
    titles = [row.get("title_ru"), row.get("title_english"), row.get("title_romaji")]
    year = row.get("start_year") or row.get("season_year")
    url = await request.app.state.yummy.find_page([t for t in titles if t], row.get("mal_id"), year)
    return {"url": url}


@router.get("/search", dependencies=[Depends(limiter(60))])
async def search(
    catalog: CatalogDep,
    q: Annotated[str, Query(max_length=100)] = "",
    deep: bool = False,
) -> dict:
    return {"query": q.strip(), "items": await catalog.search(q, deep=deep)}


@router.post("/titles", dependencies=[Depends(limiter(30))])
async def titles(body: IdsBody, catalog: CatalogDep) -> dict:
    items, missing = await catalog.titles_by_ids(body.ids)
    return {"items": items, "missing": missing}


@router.post("/related", dependencies=[Depends(limiter(20))])
async def related(body: IdsBody, catalog: CatalogDep) -> dict:
    return await catalog.related(body.ids)
