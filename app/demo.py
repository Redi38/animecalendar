"""Демо-режим: вымышленные тайтлы вместо запросов к AniList и Shikimori.

Нужен, чтобы посмотреть интерфейс без интернета и гонять тесты на детерминированных
данных. Все названия, студии и описания придуманы; совпадения с реальными случайны.
Классы повторяют интерфейс AniListClient и ShikimoriClient. Статусы и даты серий
считаются относительно текущего времени, поэтому демо всегда «живое».
"""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.i18n import normalize, search_stem

SEASON_START_MONTH = {"WINTER": 1, "SPRING": 4, "SUMMER": 7, "FALL": 10}
COLORS = ["#e4a15d", "#5de4a1", "#a15de4", "#5da1e4", "#e45d7a", "#7ae45d", "#e4d35d", "#5de4e4"]
MAL_OFFSET = 800_000
BASE_ID = 100_000

# ключ, русское, английское, ромадзи, жанры, студия, первоисточник, [(год, сезон, формат, эпизоды, точность)]
FRANCHISES: list[tuple[str, str, str, str, list[str], str, str, list[tuple]]] = [
    ("lantern", "Хроники Морского Фонаря", "Chronicles of the Lantern Sea", "Umi no Tomoshibi Kuronikuru",
     ["Adventure", "Fantasy"], "Studio Kōjitsu", "LIGHT_NOVEL",
     [(2025, "FALL", "TV", 12), (2026, "FALL", "TV", 12), (2027, "SPRING", "TV", 12, "month")]),
    ("clockwork", "Академия Серебряных Часов", "Silver Clockwork Academy", "Ginkaku Tokei Gakuen",
     ["Fantasy", "Comedy"], "Atelier Hoshimori", "MANGA",
     [(2026, "SUMMER", "TV", 12), (2027, "WINTER", "TV", 12)]),
    ("moonflight", "Последний рейс на Луну", "Last Flight to the Moon", "Tsuki e no Saishū-bin",
     ["Sci-Fi", "Drama"], "Orbit Frames", "ORIGINAL",
     [(2026, "SUMMER", "MOVIE", 1), (2027, "FALL", "MOVIE", 1, "year")]),
    ("cafe", "Кофейня на краю света", "Café at the Edge of the World", "Sekai no Hate no Kafē",
     ["Slice of Life", "Comedy"], "Studio Mugi", "MANGA", [(2026, "FALL", "TV", 12)]),
    ("stormblade", "Клинок бури", "Stormblade Requiem", "Arashi no Ken Rekuiemu",
     ["Action", "Fantasy"], "Brightline Works", "LIGHT_NOVEL",
     [(2025, "WINTER", "TV", 12), (2026, "WINTER", "TV", 12), (2026, "FALL", "TV", 24), (2027, "SUMMER", "MOVIE", 1)]),
    ("tokyo", "Тихие вечера Токио", "Tokyo Quiet Evenings", "Tōkyō Shizuka na Yūgure",
     ["Slice of Life", "Romance"], "Pale Moon Studio", "MANGA", [(2026, "FALL", "TV", 12)]),
    ("echo", "Охотники за эхом", "Echo Hunters", "Ekō Hantā",
     ["Action", "Mystery"], "Studio Kōjitsu", "ORIGINAL",
     [(2026, "SPRING", "TV", 13), (2027, "SPRING", "TV", 13)]),
    ("tabletop", "Король настолок", "Tabletop King", "Tēburutoppu Kingu",
     ["Comedy"], "Atelier Hoshimori", "MANGA", [(2026, "FALL", "TV", 12)]),
    ("starfall", "Волшебницы Звёздного города", "Magical Girls of Starfall City", "Hoshiochi-shi no Mahō Shōjo",
     ["Mahou Shoujo", "Fantasy"], "Brightline Works", "ORIGINAL",
     [(2026, "WINTER", "TV", 12), (2026, "FALL", "TV", 12)]),
    ("gardener", "Робот-садовник", "Gardener Unit 7", "Gādenā Yunitto Sebun",
     ["Sci-Fi", "Slice of Life"], "Orbit Frames", "LIGHT_NOVEL", [(2026, "FALL", "TV", 12)]),
    ("shadow", "Тень над академией", "Shadow over the Academy", "Gakuen no Kage",
     ["Supernatural", "Thriller"], "Pale Moon Studio", "MANGA",
     [(2026, "SUMMER", "TV", 12), (2027, "SPRING", "TV", 12)]),
    ("summit", "Ветер над вершиной", "Wind Over the Summit", "Itadaki no Kaze",
     ["Sports", "Drama"], "Studio Mugi", "MANGA", [(2026, "FALL", "TV", 12)]),
    ("fox", "Дневник лисьей принцессы", "The Fox Princess Diary", "Kitsune Hime no Nikki",
     ["Romance", "Fantasy"], "Atelier Hoshimori", "WEB_NOVEL",
     [(2026, "FALL", "TV", 12), (2027, "FALL", "TV", 12, "month")]),
    ("waltz", "Железный вальс", "Iron Waltz", "Tetsu no Warutsu",
     ["Mecha", "Action"], "Orbit Frames", "ORIGINAL", [(2026, "FALL", "TV", 24)]),
    ("express", "Ночной экспресс в никуда", "Nowhere Night Express", "Doko ni mo Nai Yoru Ressha",
     ["Mystery", "Horror"], "Pale Moon Studio", "ORIGINAL", [(2026, "FALL", "ONA", 8)]),
    ("nocturne", "Квартет «Ноктюрн»", "Nocturne Quartet", "Nokuchān Kuwāteto",
     ["Music", "Drama"], "Studio Mugi", "MANGA",
     [(2026, "FALL", "TV", 12), (2027, "WINTER", "OVA", 2)]),
    ("bell", "Школа последнего звонка", "The Last Bell School", "Saigo no Chaimu Gakkō",
     ["Comedy", "Slice of Life"], "Brightline Works", "MANGA",
     [(2026, "FALL", "TV", 12), (2027, "SUMMER", "TV", 12)]),
    ("rabbit", "Подземелья кроликов", "Rabbit Dungeon", "Usagi no Danjon",
     ["Fantasy", "Comedy"], "Studio Kōjitsu", "LIGHT_NOVEL",
     [(2026, "FALL", "TV", 12), (2027, "WINTER", "TV", 12)]),
    ("ashen", "Дорога пепла", "Ashen Road", "Hai no Michi",
     ["Action", "Drama"], "Brightline Works", "LIGHT_NOVEL",
     [(2026, "SPRING", "TV", 12), (2026, "FALL", "TV", 12), (2027, "FALL", "TV", 12, "month")]),
    ("library", "Тайна старой библиотеки", "Secret of the Old Library", "Furuki Toshokan no Himitsu",
     ["Mystery"], "Pale Moon Studio", "NOVEL", [(2026, "FALL", "MOVIE", 1)]),
    ("sharp", "Острые чувства", "Sharp Feelings", "Surudoi Kanjō",
     ["Romance", "Drama"], "Atelier Hoshimori", "MANGA", [(2027, "WINTER", "TV", 12)]),
    ("confectioners", "Космические кондитеры", "Cosmic Confectioners", "Uchū no Okashi-ya",
     ["Comedy", "Sci-Fi"], "Orbit Frames", "ORIGINAL", [(2027, "WINTER", "TV", 12)]),
    ("nagano", "Горные духи Нагано", "Spirits of the Nagano Mountains", "Nagano Yama no Seirei",
     ["Supernatural", "Adventure"], "Studio Mugi", "ORIGINAL", [(2027, "SPRING", "TV", 12, "month")]),
]  # fmt: skip


def _entry_date(year: int, season: str, slot: int) -> date:
    return date(year, SEASON_START_MONTH[season], 4 + (slot * 3) % 20)


class DemoData:
    """Строит ответы в формате AniList для вымышленного каталога."""

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self.entries: dict[int, dict[str, Any]] = {}
        for fi, (key, ru, en, romaji, genres, studio, source, entries) in enumerate(FRANCHISES):
            for ei, entry in enumerate(entries):
                year, season, fmt, eps = entry[:4]
                precision = entry[4] if len(entry) > 4 else "day"
                title_id = BASE_ID + fi * 10 + ei
                suffix_ru = "" if ei == 0 else f" {ei + 1}"
                suffix_en = "" if ei == 0 else f" Season {ei + 1}"
                if fmt == "MOVIE" and ei > 0:
                    suffix_ru, suffix_en = ": Фильм", ": The Movie"
                self.entries[title_id] = {
                    "id": title_id,
                    "key": key,
                    "index": ei,
                    "ru": ru + suffix_ru,
                    "en": en + suffix_en,
                    "romaji": romaji + (f" {ei + 1}" if ei else ""),
                    "genres": genres,
                    "studio": studio,
                    "source": source,
                    "year": year,
                    "season": season,
                    "format": fmt,
                    "episodes": eps,
                    "precision": precision,
                    "date": _entry_date(year, season, fi),
                    "popularity": 60_000 - fi * 2_000 - ei * 300,
                    "score": None if year >= 2027 else 62 + (fi * 7) % 30,
                    "color": COLORS[fi % len(COLORS)],
                    "siblings": [BASE_ID + fi * 10 + j for j in range(len(entries))],
                }

    def today(self) -> date:
        return datetime.fromtimestamp(self._clock(), UTC).date()

    def _status(self, e: dict[str, Any]) -> tuple[str, dict | None]:
        today = self.today()
        start: date = e["date"]
        if e["precision"] != "day":
            first = start.replace(day=1) if e["precision"] == "month" else start.replace(month=1, day=1)
            return ("NOT_YET_RELEASED" if first > today.replace(day=1) else "RELEASING"), None
        if today < start:
            return "NOT_YET_RELEASED", None
        if e["format"] == "MOVIE":
            return "FINISHED", None
        weekly = e["format"] in ("TV", "ONA")
        last = start + timedelta(days=7 * (e["episodes"] - 1)) if weekly else start
        if today > last:
            return "FINISHED", None
        done = (today - start).days // 7 + 1
        airing_day = start + timedelta(days=7 * done)
        airing_at = int(datetime(airing_day.year, airing_day.month, airing_day.day, 15, 30, tzinfo=UTC).timestamp())
        return "RELEASING", {"airingAt": airing_at, "episode": done + 1}

    def _node(self, e: dict[str, Any]) -> dict[str, Any]:
        status, _ = self._status(e)
        start: date = e["date"]
        precision = e["precision"]
        return {
            "id": e["id"],
            "idMal": e["id"] + MAL_OFFSET,
            "type": "ANIME",
            "isAdult": False,
            "title": {"romaji": e["romaji"], "english": e["en"], "native": e["romaji"]},
            "format": e["format"],
            "status": status,
            "season": e["season"],
            "seasonYear": e["year"],
            "startDate": {
                "year": start.year,
                "month": start.month if precision in ("day", "month") else None,
                "day": start.day if precision == "day" else None,
            },
            "episodes": e["episodes"],
            "averageScore": e["score"],
            "popularity": e["popularity"],
            "coverImage": {"large": None, "color": e["color"]},
        }

    def media(self, title_id: int) -> dict[str, Any] | None:
        e = self.entries.get(title_id)
        if e is None:
            return None
        _, nxt = self._status(e)
        node = self._node(e)
        edges = []
        for sib in e["siblings"]:
            if abs(sib - e["id"]) != 1:  # как в AniList: связаны соседние части, а не все со всеми
                continue
            rel = "SEQUEL" if sib > e["id"] else "PREQUEL"
            edges.append({"relationType": rel, "node": self._node(self.entries[sib])})
        if e["source"] in ("MANGA", "LIGHT_NOVEL", "NOVEL", "WEB_NOVEL"):
            edges.append(
                {
                    "relationType": "ADAPTATION",
                    "node": {
                        "id": e["id"] + 5_000_000,
                        "idMal": None,
                        "type": "MANGA",
                        "isAdult": False,
                        "title": {"romaji": e["romaji"], "english": e["en"], "native": None},
                        "format": "MANGA",
                        "status": "FINISHED",
                        "season": None,
                        "seasonYear": None,
                        "startDate": {"year": 2018, "month": None, "day": None},
                        "episodes": None,
                        "averageScore": None,
                        "popularity": 1,
                        "coverImage": {"large": None, "color": None},
                    },
                }
            )
        node.update(
            {
                "duration": 24 if e["format"] != "MOVIE" else 105,
                "source": e["source"],
                "genres": e["genres"],
                "studios": {"nodes": [{"name": e["studio"]}]},
                "nextAiringEpisode": nxt,
                "description": (
                    f"<i>Демо-данные.</i><br>Вымышленная история «{e['en']}»: "
                    f"{' и '.join(g.lower() for g in e['genres'])}, студия {e['studio']}."
                ),
                "relations": {"edges": edges},
            }
        )
        return node

    def description_ru(self, title_id: int) -> str | None:
        e = self.entries.get(title_id)
        if e is None:
            return None
        return (
            f"Демо-данные. Вымышленный тайтл «{e['ru']}» нужен, чтобы показать, как выглядит карточка "
            f"с русским описанием. Студия: {e['studio']}."
        )


class DemoAniList:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.data = DemoData(clock)

    async def aclose(self) -> None:
        return None

    async def season_page(self, season: str, year: int, page: int) -> tuple[list[dict], bool]:
        ids = sorted(
            (e["id"] for e in self.data.entries.values() if e["season"] == season and e["year"] == year),
            key=lambda i: (-self.data.entries[i]["popularity"], i),
        )
        size = 50
        chunk = ids[(page - 1) * size : page * size]
        return [m for i in chunk if (m := self.data.media(i))], page * size < len(ids)

    async def tba_page(self, page: int) -> tuple[list[dict], bool]:
        """Пара вымышленных анонсов без даты, чтобы вкладка не была пустой в демо-режиме."""
        if page > 1:
            return [], False
        demo = [
            (BASE_ID + 900, "Хроники звёздного садовника", "Chronicles of the Star Gardener", 3200),
            (BASE_ID + 901, "Последний поезд до полнолуния", "Last Train to the Full Moon", 2100),
        ]
        media: list[dict[str, Any]] = [
            {
                "id": i,
                "idMal": None,
                "type": "ANIME",
                "isAdult": False,
                "title": {"romaji": en, "english": en, "native": None},
                "format": "TV",
                "status": "NOT_YET_RELEASED",
                "season": None,
                "seasonYear": None,
                "startDate": {"year": None, "month": None, "day": None},
                "episodes": None,
                "duration": None,
                "source": "ORIGINAL",
                "genres": ["Fantasy"],
                "averageScore": None,
                "popularity": pop,
                "coverImage": {"large": None, "color": None},
                "studios": {"nodes": []},
                "nextAiringEpisode": None,
                "description": f"<i>Демо-данные.</i><br>Анонс «{ru}» пока без даты выхода.",
                "relations": {"edges": []},
            }
            for i, ru, en, pop in demo
        ]
        return media, False

    async def by_ids(self, ids: list[int]) -> list[dict]:
        return [m for i in ids if (m := self.data.media(i))]

    async def by_mal_ids(self, ids: list[int]) -> list[dict]:
        return [m for i in ids if (m := self.data.media(i - MAL_OFFSET))]

    async def search(self, q: str, limit: int = 12) -> list[dict]:
        needle = normalize(q)
        found = [
            e["id"]
            for e in self.data.entries.values()
            if needle in normalize(e["en"]) or needle in normalize(e["romaji"])
        ]
        return [m for i in found[:limit] if (m := self.data.media(i))]


class DemoShikimori:
    enabled = True

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.data = DemoData(clock)

    async def aclose(self) -> None:
        return None

    async def russian_names(self, mal_ids: list[int]) -> tuple[dict[int, str], set[int]]:
        names = {m: self.data.entries[m - MAL_OFFSET]["ru"] for m in mal_ids if (m - MAL_OFFSET) in self.data.entries}
        return names, set(mal_ids)

    async def search(self, q: str, limit: int = 12) -> list[dict[str, Any]]:
        tokens = [search_stem(t) for t in normalize(q).split()]
        out = []
        for e in self.data.entries.values():
            name = normalize(e["ru"])
            if tokens and all(t in name for t in tokens):
                out.append({"mal_id": e["id"] + MAL_OFFSET, "russian": e["ru"], "name": e["romaji"]})
        return out[:limit]

    async def description(self, mal_id: int) -> str | None:
        return self.data.description_ru(mal_id - MAL_OFFSET) or ""
