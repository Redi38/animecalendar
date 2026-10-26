from app import i18n


def test_plain_text_strips_html_and_keeps_paragraphs():
    raw = "Первая строка<br>Вторая <i>курсивом</i>&amp;<br><br><br>Третья"
    assert i18n.plain_text(raw) == "Первая строка\nВторая курсивом&\n\nТретья"


def test_plain_text_empty():
    assert i18n.plain_text(None) is None
    assert i18n.plain_text("  <br> ") is None


def test_bbcode_text():
    raw = "[character=1]Рин[/character] встречает [[Сакуру]] и [spoiler=тайна]секрет[/spoiler]."
    assert i18n.bbcode_text(raw) == "Рин встречает Сакуру и секрет."


def test_normalize_folds_yo_case_and_punctuation():
    assert i18n.normalize("Ёжик: Re:Zero!") == "ежик re zero"
    assert i18n.normalize(None) == ""


def test_has_cyrillic():
    assert i18n.has_cyrillic("Наруто")
    assert i18n.has_cyrillic("Naruto Шиппуден")
    assert not i18n.has_cyrillic("Naruto 2")


def test_all_known_genres_have_russian_names():
    anilist_genres = {
        "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror", "Mahou Shoujo", "Mecha",
        "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural",
        "Thriller",
    }  # fmt: skip
    assert anilist_genres <= set(i18n.GENRE_RU)


def test_search_stem_handles_russian_case_endings():
    assert i18n.search_stem("луна") == "лун"
    assert i18n.search_stem("лунный") == "лунны"  # «й» отбрасывается, «лунны» входит в «лунный» и «лунным»
    assert i18n.search_stem("кот") == "кот"  # короткие слова не трогаем
    assert i18n.search_stem("naruto") == "naruto"  # латиницу не трогаем
    assert i18n.search_stem("re") == "re"
