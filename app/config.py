from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DB_PATH: str = "data/anime.db"
    LOG_LEVEL: str = "INFO"

    # Каталог, связи между тайтлами, поиск латиницей.
    ANILIST_URL: str = "https://graphql.anilist.co"
    # Русские названия, описания и поиск кириллицей. ID на Shikimori совпадают
    # с ID на MyAnimeList, поэтому сопоставление идёт по idMal из AniList.
    SHIKIMORI_BASE: str = "https://shikimori.io"
    SHIKIMORI_ENABLED: bool = True
    HTTP_USER_AGENT: str = "anime-calendar-ru/1.0"

    # Показывать тайтлы 18+ и жанры, которые Shikimori по умолчанию скрывает (яой, юри, хентай).
    # Календарь сезонов остаётся без взрослого контента: настройка действует на поиск,
    # загрузку списка просмотренного и связанные анонсы.
    ALLOW_ADULT: bool = False

    # Кнопка «Смотреть онлайн» в карточке тайтла: шаблон ссылки поиска, {q} заменяется названием.
    # Пустое значение прячет кнопку. Сервис внешний и неофициальный, при желании замените его здесь.
    WATCH_URL: str = "https://old.yummyani.me/search?word={q}"

    # За обратным прокси (Caddy/nginx) берём IP клиента из X-Forwarded-For.
    TRUST_PROXY_HEADERS: bool = False

    # Прогреть текущий и следующий сезон при старте, чтобы первый посетитель
    # не ждал ответа AniList.
    PREWARM: bool = True

    # Демо-режим: вместо внешних API используются вымышленные тайтлы из
    # app/demo.py. Нужен, чтобы посмотреть интерфейс без интернета.
    DEMO_MODE: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
