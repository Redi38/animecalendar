"""Русские подписи для значений из AniList и небольшие текстовые хелперы."""

from __future__ import annotations

import html
import re

FORMAT_RU: dict[str, str] = {
    "TV": "ТВ-сериал",
    "TV_SHORT": "ТВ (короткие серии)",
    "MOVIE": "Фильм",
    "SPECIAL": "Спешл",
    "OVA": "OVA",
    "ONA": "ONA",
    "MUSIC": "Клип",
}

STATUS_RU: dict[str, str] = {
    "NOT_YET_RELEASED": "Анонс",
    "RELEASING": "Выходит",
    "FINISHED": "Вышло",
    "CANCELLED": "Отменено",
    "HIATUS": "Перерыв",
}

SOURCE_RU: dict[str, str] = {
    "ORIGINAL": "Оригинал",
    "MANGA": "Манга",
    "LIGHT_NOVEL": "Ранобэ",
    "VISUAL_NOVEL": "Визуальная новелла",
    "VIDEO_GAME": "Игра",
    "GAME": "Игра",
    "NOVEL": "Роман",
    "WEB_NOVEL": "Веб-новелла",
    "DOUJINSHI": "Додзинси",
    "ANIME": "Аниме",
    "LIVE_ACTION": "Игровое кино",
    "COMIC": "Комикс",
    "MULTIMEDIA_PROJECT": "Мультимедийный проект",
    "PICTURE_BOOK": "Книга с картинками",
    "OTHER": "Другое",
}

GENRE_RU: dict[str, str] = {
    "Action": "Экшен",
    "Adventure": "Приключения",
    "Comedy": "Комедия",
    "Drama": "Драма",
    "Ecchi": "Этти",
    "Fantasy": "Фэнтези",
    "Horror": "Ужасы",
    "Mahou Shoujo": "Махо-сёдзё",
    "Mecha": "Меха",
    "Music": "Музыка",
    "Mystery": "Детектив",
    "Psychological": "Психологическое",
    "Romance": "Романтика",
    "Sci-Fi": "Фантастика",
    "Slice of Life": "Повседневность",
    "Sports": "Спорт",
    "Supernatural": "Сверхъестественное",
    "Thriller": "Триллер",
}

# Как тайтл относится к тому, что человек уже посмотрел (тип связи в AniList).
RELATION_RU: dict[str, str] = {
    "SEQUEL": "Продолжение",
    "PREQUEL": "Предыстория",
    "SIDE_STORY": "Побочная история",
    "SPIN_OFF": "Спин-офф",
    "PARENT": "Основная история",
    "ALTERNATIVE": "Альтернативная версия",
    "SUMMARY": "Краткий пересказ",
    "COMPILATION": "Сборник",
    "CONTAINS": "Содержит",
    "CHARACTER": "Общие персонажи",
    "ADAPTATION": "Адаптация",
    "SOURCE": "Первоисточник",
    "OTHER": "Другое",
}

# По каким связям ищем анонсы для просмотренного. Адаптации и общие персонажи
# слишком далеки от «продолжения того, что я смотрел».
RELATED_TYPES: frozenset[str] = frozenset(
    {"SEQUEL", "PREQUEL", "SIDE_STORY", "SPIN_OFF", "PARENT", "ALTERNATIVE", "SUMMARY", "COMPILATION", "CONTAINS"}
)

_TAG_RE = re.compile(r"<[^>]+>")
_BR_RE = re.compile(r"<\s*br\s*/?\s*>", re.IGNORECASE)
_BBCODE_RE = re.compile(r"\[/?[a-z_]+(?:=[^\]]*)?\]", re.IGNORECASE)
_WS_RE = re.compile(r"[ \t\r\f\v]+")
_PUNCT_RE = re.compile(r"[\W_]+", re.UNICODE)


def plain_text(raw: str | None) -> str | None:
    """HTML из AniList / Shikimori -> простой текст с переводами строк."""
    if not raw:
        return None
    text = _BR_RE.sub("\n", raw)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    lines = [_WS_RE.sub(" ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or None


def bbcode_text(raw: str | None) -> str | None:
    """Разметка Shikimori ([character=1]Имя[/character], [[ссылка]]) -> простой текст."""
    if not raw:
        return None
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", raw)
    text = _BBCODE_RE.sub("", text)
    return plain_text(text)


def normalize(text: str | None) -> str:
    """Нормализация для поиска: регистр, ё=е, знаки препинания -> пробелы."""
    if not text:
        return ""
    folded = text.casefold().replace("ё", "е")
    return _PUNCT_RE.sub(" ", folded).strip()


_CASE_ENDINGS = "аяуюыиеоьй"


def search_stem(token: str) -> str:
    """Грубая основа слова для поиска по русским названиям: «луна» находит «Луну», «лунный» — «лунного».

    Отбрасываем одну конечную гласную (или ь/й) у кириллических слов от 4 букв. Это не лемматизация,
    но для названий аниме её хватает: лишние совпадения отсекает требование «все слова запроса».
    """
    if len(token) >= 4 and token[-1] in _CASE_ENDINGS and has_cyrillic(token):
        return token[:-1]
    return token


def has_cyrillic(text: str) -> bool:
    return any("Ѐ" <= ch <= "ӿ" for ch in text)
