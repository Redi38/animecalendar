"""Зависимости FastAPI: доступ к объектам приложения без обращения к request.app.state в обработчиках."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from app.providers.yummy import YummyClient
from app.services.catalog import Catalog


def catalog_of(request: Request) -> Catalog:
    return request.app.state.catalog


def yummy_of(request: Request) -> YummyClient:
    return request.app.state.yummy


CatalogDep = Annotated[Catalog, Depends(catalog_of)]
YummyDep = Annotated[YummyClient, Depends(yummy_of)]
