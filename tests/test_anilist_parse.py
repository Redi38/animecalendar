import json

from app.providers.anilist import parse_media, parse_relations

MEDIA = {
    "id": 1,
    "idMal": 11,
    "type": "ANIME",
    "isAdult": False,
    "title": {"romaji": "Romaji", "english": None, "native": "ネイティブ"},
    "format": "TV",
    "status": "NOT_YET_RELEASED",
    "season": "WINTER",
    "seasonYear": 2027,
    "startDate": {"year": 2027, "month": 1, "day": None},
    "episodes": None,
    "duration": 24,
    "source": "MANGA",
    "genres": ["Action", "Sci-Fi"],
    "averageScore": None,
    "popularity": 1234,
    "coverImage": {"large": "https://s4.anilist.co/x.jpg", "color": "#ff0000"},
    "studios": {"nodes": [{"name": "Studio A"}, {"name": "Studio B"}]},
    "nextAiringEpisode": None,
    "description": "Line one<br>Line <i>two</i>",
    "relations": {
        "edges": [
            {"relationType": "SEQUEL", "node": {"id": 2, "idMal": 12, "type": "ANIME", "isAdult": False,
                                                "title": {"romaji": "Next"}, "format": "TV", "status": "NOT_YET_RELEASED",
                                                "startDate": {"year": 2027}, "coverImage": None}},
            {"relationType": "ADAPTATION", "node": {"id": 3, "type": "MANGA", "isAdult": False, "title": {"romaji": "M"}}},
            {"relationType": "SIDE_STORY", "node": {"id": 4, "type": "ANIME", "isAdult": True, "title": {"romaji": "X"}}},
            {"relationType": None, "node": {"id": 5, "type": "ANIME", "isAdult": False, "title": {"romaji": "Y"}}},
            {"relationType": "OTHER", "node": None},
        ]
    },
}  # fmt: skip


def test_parse_media_maps_fields_and_tolerates_nulls():
    row = parse_media(MEDIA)
    assert row["id"] == 1 and row["mal_id"] == 11
    assert row["title_english"] is None and row["title_native"] == "ネイティブ"
    assert (row["start_year"], row["start_month"], row["start_day"]) == (2027, 1, None)
    assert row["episodes"] is None and row["score"] is None
    assert json.loads(row["genres"]) == ["Action", "Sci-Fi"]
    assert json.loads(row["studios"]) == ["Studio A", "Studio B"]
    assert row["next_ep_at"] is None
    assert row["description"] == "Line one\nLine two"
    assert row["partial"] == 0


def test_parse_media_handles_missing_blocks():
    row = parse_media({"id": 9, "title": {}, "studios": None, "coverImage": None, "startDate": None})
    assert row["cover"] is None and row["start_year"] is None
    assert json.loads(row["studios"]) == []


def test_parse_relations_keeps_only_safe_anime_edges():
    edges, nodes = parse_relations(MEDIA)
    assert edges == [(2, "SEQUEL")]
    assert [n["id"] for n in nodes] == [2]
    assert nodes[0]["partial"] == 1
    assert nodes[0]["cover"] is None  # coverImage: None не должен ронять разбор


def test_parse_relations_allow_adult_keeps_adult_anime():
    media = {
        "relations": {
            "edges": [
                {
                    "relationType": "SIDE_STORY",
                    "node": {"id": 4, "type": "ANIME", "isAdult": True, "title": {"romaji": "X"}},
                },
            ]
        }
    }
    assert parse_relations(media)[0] == []
    assert parse_relations(media, allow_adult=True)[0] == [(4, "SIDE_STORY")]


def test_adult_queries_drop_only_the_filter():
    from app.providers.anilist import Q_BY_MAL_IDS, Q_BY_MAL_IDS_ADULT, Q_SEARCH, Q_SEARCH_ADULT

    for plain, adult in ((Q_BY_MAL_IDS, Q_BY_MAL_IDS_ADULT), (Q_SEARCH, Q_SEARCH_ADULT)):
        assert "isAdult: false" in plain
        assert "isAdult: false" not in adult
