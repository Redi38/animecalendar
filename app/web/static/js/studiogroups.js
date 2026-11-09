// Тайтлы студии по годам премьеры: свежие годы сверху, а анонсы без даты идут первыми, они «новее» всех.

/** Год премьеры карточки: из даты ("2026-10-06", "2026-10", "2026"), иначе из сезона. */
export function yearOf(item) {
  const fromStart = Number(String(item.start || "").slice(0, 4));
  if (fromStart > 0) return fromStart;
  return item.season_year > 0 ? item.season_year : null;
}

/** [{ key, label, items }]: порядок тайтлов внутри года сохраняется (сервер отдаёт от новых к старым). */
export function groupByYear(items) {
  const years = new Map();
  const undated = [];
  for (const item of items) {
    const year = yearOf(item);
    if (year === null) {
      undated.push(item);
      continue;
    }
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(item);
  }
  const groups = [...years.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => ({ key: String(year), label: String(year), items: list }));
  return undated.length ? [{ key: "tba", label: "Без даты", items: undated }, ...groups] : groups;
}
