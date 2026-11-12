import { orderDays } from "./daygroups.js";
import { readJson, writeJson } from "./storage.js";
import { capitalize, formatStart, normalize } from "./util.js";

export const FORMAT_GROUPS = [
  { id: "all", label: "Все", test: () => true },
  { id: "tv", label: "ТВ", test: (i) => i.format === "TV" || i.format === "TV_SHORT" },
  { id: "movie", label: "Фильмы", test: (i) => i.format === "MOVIE" },
  { id: "other", label: "ONA / OVA / спешлы", test: (i) => ["ONA", "OVA", "SPECIAL", "MUSIC"].includes(i.format) },
];

const PREF_KEY = "anime_calendar_prefs_v1";

export function loadPrefs() {
  const saved = readJson(PREF_KEY, {});
  return { group: "day", format: "all", ...(saved && typeof saved === "object" ? saved : {}) };
}

export function savePrefs(prefs) {
  writeJson(PREF_KEY, prefs);
}

/** Тайтлы сезона под фильтры: формат, слова из строки поиска (все должны встретиться) и «только связанные с моим списком». */
export function filterItems(items, { format, text, onlyRelated, relatedIds }) {
  const fmt = FORMAT_GROUPS.find((g) => g.id === format) || FORMAT_GROUPS[0];
  const words = normalize(text).split(" ").filter(Boolean);
  return items.filter((item) => {
    if (!fmt.test(item)) return false;
    if (onlyRelated && !relatedIds.has(item.id)) return false;
    if (!words.length) return true;
    const hay = normalize(`${item.title} ${item.subtitle || ""} ${item.title_native || ""}`);
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Разбивка на секции. «По популярности» — одна секция без заголовка; «По дням» — по датам выхода (порядок см. orderDays)
 * и в конце секция «Дата выхода уточняется» для тайтлов без точного дня. today — «ГГГГ-ММ-ДД».
 */
export function groupItems(items, mode, today) {
  if (mode === "popular") return [{ key: "popular", title: null, items }];
  const byDay = new Map();
  const undated = [];
  for (const item of items) {
    if (item.start_precision === "day") {
      if (!byDay.has(item.start)) byDay.set(item.start, []);
      byDay.get(item.start).push(item);
    } else {
      undated.push(item);
    }
  }
  const groups = orderDays([...byDay.keys()], today).map((day) => ({
    key: day,
    day,
    title: capitalize(formatStart(day, "day", "group")),
    items: byDay.get(day),
  }));
  if (undated.length) groups.push({ key: "undated", title: "Дата выхода уточняется", items: undated });
  return groups;
}
