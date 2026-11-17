// Список просмотренного живёт в localStorage браузера (без аккаунтов).
// Если хранилище недоступно (приватный режим, запрет cookies), работаем из памяти.

import { readJson, writeJson } from "./storage.js";

const KEY = "anime_calendar_v1";
export const MAX_WATCHED = 5000; // потолок списка; карточки с сервера берутся пачками по 500

let watched = new Set();
let planned = new Set(); // «Хочу посмотреть»: тайтл либо здесь, либо в просмотренном (отметка «просмотрено» переносит его)
let ignored = new Set(); // тайтлы, скрытые из «Моих анонсов» (их можно вернуть на странице «Скрытые тайтлы»)
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
  ignored = new Set(ids(data.ignored) || []);
  planned = new Set((ids(data.planned) || []).filter((id) => !watched.has(id)));
  imported = {};
  if (data.imported && typeof data.imported === "object") {
    for (const [id, title] of Object.entries(data.imported)) {
      if (watched.has(Number(id)) && typeof title === "string" && title) imported[id] = title;
    }
  }
}

function save() {
  // хранилище недоступно — данные останутся до закрытия вкладки
  writeJson(KEY, { watched: [...watched], planned: [...planned], seen: seen ? [...seen] : null, imported, ignored: [...ignored] });
}

/** source — откуда изменение: «sync» значит, что список обновила синхронизация, а не пользователь на этой странице. */
function emit(source) {
  for (const fn of listeners) fn(source);
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
    else {
      watched.add(id);
      planned.delete(id);
    }
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
        planned.delete(id);
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
        planned.delete(id);
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
    planned.delete(newId);
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

  // «Хочу посмотреть»
  isPlanned: (id) => planned.has(id),
  plannedSize: () => planned.size,
  plannedIds: () => [...planned],

  /** Добавляет в «Хочу посмотреть» или убирает оттуда. Просмотренный тайтл не добавляется (он уже в другом списке). false — упёрлись в лимит. */
  togglePlanned(id) {
    if (!Number.isInteger(id) || id <= 0 || watched.has(id)) return true;
    if (planned.has(id)) planned.delete(id);
    else if (planned.size >= MAX_WATCHED) return false;
    else planned.add(id);
    save();
    emit();
    return true;
  },

  // «Скрытые тайтлы»: то, что не планируешь смотреть, пропадает из «Моих анонсов», но остаётся в этом списке
  isIgnored: (id) => ignored.has(id),
  ignoredSize: () => ignored.size,
  ignoredIds: () => [...ignored],

  /** true — тайтл скрыт (или уже был скрыт), false — упёрлись в лимит. */
  ignore(id) {
    if (!Number.isInteger(id) || id <= 0) return false;
    if (ignored.has(id)) return true;
    if (ignored.size >= MAX_WATCHED) return false;
    ignored.add(id);
    save();
    emit();
    return true;
  },

  /** Возвращает тайтл в «Мои анонсы». true — был скрыт и возвращён. */
  restore(id) {
    if (!ignored.delete(id)) return false;
    save();
    emit();
    return true;
  },

  /** Копия всего, что синхронизируется между устройствами. */
  snapshot: () => ({ watched: [...watched], planned: [...planned], ignored: [...ignored], seen: seen ? [...seen] : null, imported: { ...imported } }),

  /** Применяет результат слияния с облаком (списки уже проверены в syncmerge.js). Подписчики получают источник «sync». */
  applyMerged(state) {
    watched = new Set(state.watched);
    ignored = new Set(state.ignored);
    planned = new Set((state.planned || []).filter((id) => !watched.has(id)));
    seen = state.seen ? new Set(state.seen) : null;
    imported = {};
    for (const [id, title] of Object.entries(state.imported || {})) {
      if (watched.has(Number(id))) imported[id] = title;
    }
    save();
    emit("sync");
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
