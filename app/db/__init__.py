"""SQLite-кэш каталога (aiosqlite).

Хранит тайтлы целиком (полные записи из сезонных выборок) и «неполные» —
узлы связей, у которых известны только название, статус и дата. Неполные
записи достаточно, чтобы показать карточку анонса, а полные подтягиваются
по требованию.

Database собирается из миксинов по таблицам: titles, seasons, relations, studio_pages;
соединение и общие помощники лежат в base.
"""

from __future__ import annotations

from app.db.relations import RelationsMixin
from app.db.schema import SCHEMA_VERSION
from app.db.seasons import SeasonsMixin
from app.db.studio_pages import StudioPagesMixin
from app.db.titles import TitlesMixin, build_search_text

__all__ = ["SCHEMA_VERSION", "Database", "build_search_text"]


class Database(TitlesMixin, SeasonsMixin, RelationsMixin, StudioPagesMixin):
    """Единая точка доступа к базе: все методы доступны на одном объекте, как и раньше."""
