// Разбор адреса страницы (#/...) в описание маршрута. Чистая функция, без обращения к DOM.

/** "#/season/2026/fall" -> { name: "season", year: 2026, slug: "fall" }. Неизвестный адрес -> { name: "home" }. */
export function parseRoute(hash) {
  const path = hash.replace(/^#/, "") || "/";
  let m;
  if ((m = path.match(/^\/title\/(\d+)$/))) return { name: "title", id: Number(m[1]) };
  if ((m = path.match(/^\/season\/(\d{4})\/(winter|spring|summer|fall)$/))) {
    return { name: "season", year: Number(m[1]), slug: m[2] };
  }
  if ((m = path.match(/^\/search\/(.+)$/))) {
    try {
      return { name: "search", q: decodeURIComponent(m[1]).slice(0, 100) };
    } catch {
      return { name: "home" };
    }
  }
  if (path === "/tba") return { name: "tba" };
  if (path === "/watched") return { name: "watched" };
  if (path === "/upcoming") return { name: "upcoming" };
  if (path === "/ignored") return { name: "ignored" };
  return { name: "home" };
}

/** Какой пункт верхнего меню подсвечивать для страницы: «Афиша» держит сезоны и анонсы без даты, «Скрытые» живут под «Моими анонсами». */
export function navName(route) {
  if (route.name === "season" || route.name === "tba") return "season";
  if (route.name === "ignored") return "upcoming";
  return route.name;
}
