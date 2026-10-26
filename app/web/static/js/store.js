// Список просмотренного живёт в localStorage браузера (без аккаунтов).
// Если хранилище недоступно (приватный режим, запрет cookies), работаем из памяти.

const KEY = "anime_calendar_v1";
export const MAX_WATCHED = 500; // столько ID принимает API за один запрос

let watched = new Set();
let seen = null; // null — «Новое» ещё не инициализировано (первый визит)
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const ids = (list) => (Array.isArray(list) ? list.filter((x) => Number.isInteger(x) && x > 0) : null);
    watched = new Set(ids(data.watched) || []);
    const s = ids(data.seen);
    seen = s ? new Set(s) : null;
  } catch {
    /* повреждённые данные — начинаем с чистого листа */
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ watched: [...watched], seen: seen ? [...seen] : null }));
  } catch {
    /* хранилище недоступно — данные останутся до закрытия вкладки */
  }
}

function emit() {
  for (const fn of listeners) fn();
}

load();

export const store = {
  has: (id) => watched.has(id),
  size: () => watched.size,
  ids: () => [...watched],

  /** true — добавлено/убрано, false — упёрлись в лимит. */
  toggle(id) {
    if (watched.has(id)) watched.delete(id);
    else if (watched.size >= MAX_WATCHED) return false;
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

  clear() {
    watched.clear();
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
