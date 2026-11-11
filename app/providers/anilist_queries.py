"""GraphQL-запросы к AniList. Разбор ответов — в anilist_parse, клиент — в anilist."""

_MEDIA_FRAGMENT = """
fragment M on Media {
  id
  idMal
  type
  isAdult
  title { romaji english native }
  format
  status
  season
  seasonYear
  startDate { year month day }
  episodes
  duration
  source
  genres
  averageScore
  popularity
  coverImage { large color }
  studios(isMain: true) { nodes { id name } }
  nextAiringEpisode { airingAt episode }
  description(asHtml: false)
  relations {
    edges {
      relationType(version: 2)
      node {
        id
        idMal
        type
        isAdult
        title { romaji english native }
        format
        status
        season
        seasonYear
        startDate { year month day }
        episodes
        averageScore
        popularity
        coverImage { large color }
      }
    }
  }
}
"""

Q_SEASON = (
    """
query ($season: MediaSeason, $year: Int, $page: Int, $per: Int) {
  Page(page: $page, perPage: $per) {
    pageInfo { hasNextPage }
    media(type: ANIME, season: $season, seasonYear: $year, isAdult: false, sort: [POPULARITY_DESC, ID]) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

# Анонсы без даты: сортировка по популярности, «без даты» отбирается в коде (is_tba).
Q_TBA = (
    """
query ($page: Int, $per: Int) {
  Page(page: $page, perPage: $per) {
    pageInfo { hasNextPage }
    media(type: ANIME, status: NOT_YET_RELEASED, isAdult: false, sort: [POPULARITY_DESC, ID]) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

# Список тайтлов студии: лёгкие записи (как у узлов связей), полную карточку тайтл получит при открытии.
# Только главные студии (isMain), от новых к старым. Имя студии приходит вместе с первой страницей.
Q_STUDIO = """
query ($id: Int, $page: Int, $per: Int) {
  Studio(id: $id) {
    id
    name
    media(page: $page, perPage: $per, sort: [START_DATE_DESC, ID_DESC], isMain: true) {
      pageInfo { hasNextPage }
      nodes {
        id
        idMal
        type
        isAdult
        title { romaji english native }
        format
        status
        season
        seasonYear
        startDate { year month day }
        episodes
        averageScore
        popularity
        coverImage { large color }
      }
    }
  }
}
"""

Q_BY_IDS = (
    """
query ($ids: [Int], $per: Int) {
  Page(page: 1, perPage: $per) {
    media(type: ANIME, id_in: $ids) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

Q_BY_MAL_IDS = (
    """
query ($ids: [Int], $per: Int) {
  Page(page: 1, perPage: $per) {
    media(type: ANIME, idMal_in: $ids, isAdult: false) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

Q_SEARCH = (
    """
query ($q: String, $per: Int) {
  Page(page: 1, perPage: $per) {
    media(type: ANIME, search: $q, isAdult: false, sort: SEARCH_MATCH) { ...M }
  }
}
"""
    + _MEDIA_FRAGMENT
)

# Те же запросы без фильтра isAdult (настройка ALLOW_ADULT). Календарь сезонов фильтр сохраняет.
Q_BY_MAL_IDS_ADULT = Q_BY_MAL_IDS.replace(", isAdult: false", "")
Q_SEARCH_ADULT = Q_SEARCH.replace(", isAdult: false", "")
