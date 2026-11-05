// Франшизы: сезоны, фильмы, OVA и спешлы одного тайтла собираются в группу.
// Здесь только чистая логика (без DOM); сами группы приходят с сервера (/api/groups и поле groups в /api/search).

import { formatTitles } from "./util.js";

/** Ключ сортировки по дате премьеры: неточные даты уходят в конец своего периода, неизвестные — в самый конец. */
export function startKey(item) {
  const start = item?.start;
  if (!start) return "9999-99-99";
  const [year, month = "13", day = "32"] = start.split("-");
  return `${year}-${month}-${day}`;
}

/** Порядок внутри группы: по дате премьеры, при равенстве — по id. */
export function byStart(a, b) {
  const ka = startKey(a);
  const kb = startKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : a.id - b.id;
}

/**
 * Раскладывает список просмотренного по франшизам.
 * items — карточки тайтлов; groups — [{ id, title, cover, color, total, seeds }] с сервера.
 * Группа — это два и больше тайтлов из списка; одиночные тайтлы остаются карточками.
 * Возвращает записи { kind: "group", id, title, cover, color, total, items } и { kind: "single", id, title, item }:
 * сначала все группы, затем одиночные тайтлы; и те и другие — по названию.
 */
export function arrangeByFranchise(items, groups) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const used = new Set();
  const entries = [];
  for (const g of groups || []) {
    const members = (g.seeds || []).map((id) => byId.get(id)).filter((item) => item && !used.has(item.id));
    if (members.length < 2) continue;
    for (const m of members) used.add(m.id);
    entries.push({
      kind: "group",
      id: g.id,
      title: g.title,
      cover: g.cover,
      color: g.color,
      total: g.total,
      items: members.sort(byStart),
    });
  }
  for (const item of items) {
    if (!used.has(item.id)) entries.push({ kind: "single", id: item.id, title: item.title, item });
  }
  const byTitle = (a, b) => a.title.localeCompare(b.title, "ru") || a.id - b.id;
  return [...entries.filter((e) => e.kind === "group").sort(byTitle), ...entries.filter((e) => e.kind === "single").sort(byTitle)];
}

/** «3 тайтла · ТВ-сериал ×2, Фильм» — что внутри группы. */
export function describeGroup(items) {
  const counts = new Map();
  for (const item of items) {
    if (item.format_ru) counts.set(item.format_ru, (counts.get(item.format_ru) || 0) + 1);
  }
  const kinds = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
  return kinds.length ? `${formatTitles(items.length)} · ${kinds.join(", ")}` : formatTitles(items.length);
}
