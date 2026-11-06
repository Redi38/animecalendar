// Слияние списков при синхронизации между устройствами. Только чистая логика, без сети и DOM.
//
// Схема трёхсторонняя: «здесь» (local), «в облаке» (remote) и «общее состояние после прошлой синхронизации» (base).
// Так видно, кто что убрал: тайтл, который был в base, а в одной из копий пропал, убрали намеренно, и он не воскреснет.
// Без base (первая синхронизация) копии просто объединяются.

export const LIST_LIMIT = 500; // столько тайтлов принимает API за один запрос
const SEEN_LIMIT = 5000;
const TITLE_MAX = 300;
export const FILE_VERSION = 1;

const isId = (x) => Number.isInteger(x) && x > 0;

/** Список положительных целых без повторов и не длиннее cap. Всё остальное отбрасывается. */
export function cleanIds(list, cap = Infinity) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const x of list) {
    if (!isId(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Слияние одного списка. Порядок: сначала то, что в облаке (в его порядке), затем добавленное только здесь.
 * truncated — список не поместился в limit, лишнее отброшено.
 */
export function mergeSets(local, remote, base, limit = Infinity) {
  const L = new Set(local);
  const R = new Set(remote);
  const B = new Set(base || []);
  const keep = (id) => (L.has(id) && R.has(id)) || (!B.has(id) && (L.has(id) || R.has(id)));
  const out = [];
  const taken = new Set();
  for (const id of [...remote, ...local]) {
    if (taken.has(id) || !keep(id)) continue;
    taken.add(id);
    out.push(id);
  }
  return { ids: out.slice(0, limit), truncated: out.length > limit };
}

/** Состояние из произвольных данных (файл из облака — недоверенный ввод). null, если это не наши данные. */
export function normalize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const watched = cleanIds(raw.watched, LIST_LIMIT);
  const imported = {};
  if (raw.imported && typeof raw.imported === "object") {
    const inList = new Set(watched);
    for (const [id, title] of Object.entries(raw.imported)) {
      if (inList.has(Number(id)) && typeof title === "string" && title) imported[id] = title.slice(0, TITLE_MAX);
    }
  }
  return {
    watched,
    ignored: cleanIds(raw.ignored, LIST_LIMIT),
    seen: Array.isArray(raw.seen) ? cleanIds(raw.seen, SEEN_LIMIT) : null,
    imported,
  };
}

const EMPTY = { watched: [], ignored: [], seen: null, imported: {} };

/**
 * Слияние всего состояния. base — { watched, ignored } после прошлой синхронизации или null.
 * «Новое» (seen) только растёт, поэтому там обычное объединение. Возвращает { state, truncated }.
 */
export function mergeState(local, remote, base) {
  const r = remote || EMPTY;
  const watched = mergeSets(local.watched, r.watched, base?.watched, LIST_LIMIT);
  const ignored = mergeSets(local.ignored, r.ignored, base?.ignored, LIST_LIMIT);
  const seen = local.seen === null && r.seen === null ? null : cleanIds([...(r.seen || []), ...(local.seen || [])], SEEN_LIMIT);
  const imported = {};
  for (const id of watched.ids) {
    const title = local.imported?.[id] ?? r.imported?.[id];
    if (title) imported[id] = title;
  }
  return { state: { watched: watched.ids, ignored: ignored.ids, seen, imported }, truncated: watched.truncated || ignored.truncated };
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a, b) => {
  if (a === null || b === null) return a === b;
  return a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;
};
const sameMap = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** Совпадают ли состояния. Порядок важен только у просмотренного («по порядку добавления»). */
export function sameState(a, b) {
  return sameList(a.watched, b.watched) && sameSet(a.ignored, b.ignored) && sameSet(a.seen, b.seen) && sameMap(a.imported, b.imported);
}

/** Содержимое файла в облаке. */
export function toFile(state, now = new Date()) {
  return { version: FILE_VERSION, updated: now.toISOString(), ...state };
}
