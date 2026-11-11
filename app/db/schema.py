"""Схема SQLite и списки колонок таблицы titles."""

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS titles (
    id INTEGER PRIMARY KEY,
    mal_id INTEGER,
    title_romaji TEXT,
    title_english TEXT,
    title_native TEXT,
    title_ru TEXT,
    search_text TEXT NOT NULL DEFAULT '',
    format TEXT,
    status TEXT,
    season TEXT,
    season_year INTEGER,
    start_year INTEGER,
    start_month INTEGER,
    start_day INTEGER,
    episodes INTEGER,
    duration INTEGER,
    source TEXT,
    genres TEXT,
    studios TEXT,
    next_ep_at INTEGER,
    next_ep_number INTEGER,
    score INTEGER,
    popularity INTEGER NOT NULL DEFAULT 0,
    cover TEXT,
    cover_color TEXT,
    description TEXT,
    description_ru TEXT,
    desc_ru_checked_at INTEGER,
    ru_checked_at INTEGER,
    relations_synced_at INTEGER,
    synced_at INTEGER NOT NULL DEFAULT 0,
    partial INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_titles_season ON titles (season_year, season);
CREATE INDEX IF NOT EXISTS idx_titles_mal ON titles (mal_id);

CREATE TABLE IF NOT EXISTS relations (
    source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations (target_id);

-- Страницы списка тайтлов студии (порядок AniList: от новых к старым). Сами тайтлы лежат в titles.
CREATE TABLE IF NOT EXISTS studio_pages (
    studio_id INTEGER NOT NULL,
    page INTEGER NOT NULL,
    name TEXT NOT NULL,
    ids TEXT NOT NULL,
    has_next INTEGER NOT NULL,
    synced_at INTEGER NOT NULL,
    PRIMARY KEY (studio_id, page)
);

CREATE TABLE IF NOT EXISTS season_sync (
    key TEXT PRIMARY KEY,
    synced_at INTEGER NOT NULL,
    total INTEGER NOT NULL
);
"""

# Поля, общие для полной и неполной записи.
BASIC = (
    "mal_id", "title_romaji", "title_english", "title_native", "format", "status", "season",
    "season_year", "start_year", "start_month", "start_day", "episodes", "score", "popularity",
    "cover", "cover_color",
)  # fmt: skip
# Поля, которые приходят только вместе с полной записью.
FULL_ONLY = ("duration", "source", "genres", "studios", "next_ep_at", "next_ep_number", "description")

# Тяжёлые поля (описания, поисковый индекс) нужны только карточке тайтла и самому поиску:
# в списках и сетках их не читаем.
_HEAVY = frozenset({"description", "description_ru", "search_text"})
_ALL_COLUMNS = (
    "id", *BASIC, "title_ru", "search_text", *FULL_ONLY, "description_ru",
    "desc_ru_checked_at", "ru_checked_at", "relations_synced_at", "synced_at", "partial",
)  # fmt: skip
LIGHT = ", ".join(c for c in dict.fromkeys(_ALL_COLUMNS) if c not in _HEAVY)
