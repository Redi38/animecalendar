import { storageGet, storageSet } from "./storage.js";

const SORT_KEY = "anime_calendar_watched_sort_v1";
export const SORTS = [
  { id: "alpha", label: "По алфавиту" },
  { id: "added", label: "По порядку добавления" },
  { id: "franchise", label: "По тайтлам" },
];

export function loadSort() {
  const v = storageGet(SORT_KEY);
  return SORTS.some((x) => x.id === v) ? v : "alpha";
}

export function saveSort(v) {
  storageSet(SORT_KEY, v);
}

/**
 * Порядок карточек в списке просмотренного. «По порядку добавления» берёт порядок из ids (Set хранит порядок
 * добавления); остальные сортировки — по алфавиту (для «По тайтлам» так же сортируются одиночные тайтлы).
 */
export function sortItems(items, ids, sort) {
  const order = new Map(ids.map((id, i) => [id, i]));
  return [...items].sort(
    sort === "added"
      ? (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
      : (a, b) => a.title.localeCompare(b.title, "ru"),
  );
}
