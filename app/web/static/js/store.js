// Список просмотренного живёт в localStorage браузера (без аккаунтов).
// Если хранилище недоступно (приватный режим, запрет cookies), работаем из памяти.

import { readJson, writeJson } from "./storage.js";

const KEY = "anime_calendar_v1";
export const MAX_WATCHED = 500; // столько ID принимает API за один запрос

let watched = new Set();
let seen = null; // null — «Новое» ещё не инициализировано (первый визит)
let imported = {}; // id -> название из файла, по которому тайтл нашли при импорте (чтобы исправить ошибочное совпадение)
const listeners = new Set();

function load() {
  const data = readJson(KEY); // повреждённые данные — начинаем с чистого листа
  if (!data || typeof data !== "object") return;
  const ids = (list) => (Array.isArray(list) ? list.filter((x) => Number.isInteger(x) && x > 0) : null);
  watched = new Set(ids(data.watched) || []);
  const s = ids(data.seen);
  seen = s ? new Set(s) : null;
  imported = {};
  if (data.imported && typeof data.imported === "object") {
    for (const [id, title] of Object.entries(data.imported)) {
      if (watched.has(Number(id)) && typeof title === "string" && title) imported[id] = title;
    }
  }
}

function save() {
  // хранилище недоступно — данные останутся до закрытия вкладки
  writeJson(KEY, { watched: [...watched], seen: seen ? [...seen] : null, imported });
}

function emit() {
  for (const fn of listeners) fn();
}

load();

export const store = {
  has: (id) => watched.has(id),
  size: () => watched.size,
  ids: () => [...watched],

  /** Название из файла, по которому тайтл нашли при импорте; null, если тайтл добавлен не импортом. */
  importedAs: (id) => imported[id] ?? null,

  /** true — добавлено/убрано, false — упёрлись в лимит. */
  toggle(id) {
    if (watched.has(id)) {
      watched.delete(id);
      delete imported[id];
    } else if (watched.size >= MAX_WATCHED) return false;
    else watched.add(id);
    save();
    emit();
    return true;
  },

  addMany(ids) {
    let added = 0;
    for (const id of ids) {
      if (watched.size >= MAX_WATCHED) break;
      if (Number.isInteger(id) && id > 0 && !watched.has(id)) {
        watched.add(id);
        added++;
      }
    }
    if (added) {
      save();
      emit();
    }
    return added;
  },

  /** Импорт по названиям: pairs — [{ id, title }]. Запоминает исходное название для каждого нового тайтла. */
  addImported(pairs) {
    let added = 0;
    for (const { id, title } of pairs) {
      if (watched.size >= MAX_WATCHED) break;
      if (Number.isInteger(id) && id > 0 && !watched.has(id)) {
        watched.add(id);
        if (typeof title === "string" && title) imported[id] = title;
        added++;
      }
    }
    if (added) {
      save();
      emit();
    }
    return added;
  },

  /**
   * Подменяет тайтл на другой, сохраняя место в списке (порядок «по добавлению»).
   * "replaced" — подмена выполнена; "merged" — новый тайтл уже был в списке, старый просто убран;
   * "unchanged" — нечего менять.
   */
  replace(oldId, newId) {
    if (!watched.has(oldId) || !Number.isInteger(newId) || newId <= 0 || newId === oldId) return "unchanged";
    const source = imported[oldId];
    delete imported[oldId];
    if (watched.has(newId)) {
      watched.delete(oldId);
      save();
      emit();
      return "merged";
    }
    watched = new Set([...watched].map((id) => (id === oldId ? newId : id)));
    if (source) imported[newId] = source;
    save();
    emit();
    return "replaced";
  },

  clear() {
    watched.clear();
    imported = {};
    save();
    emit();
  },

  // «Новое» во вкладке анонсов
  seenReady: () => seen !== null,
  isSeen: (id) => seen !== null && seen.has(id),
  markSeen(ids) {
    if (seen === null) seen = new Set();
    let changed = false;
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        changed = true;
      }
    }
    if (changed) save();
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
