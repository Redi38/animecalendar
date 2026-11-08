// Связанные анонсы: данные по списку просмотренного, из них считаются значок на вкладке и отметки «★» в сетках.
// Один запрос на состояние списка; пока сервер сообщает incomplete, запрос повторяется, и обход связей идёт дальше.

import { debounce } from "./util.js";

export const RETRY_MS = 3000;
export const MAX_RETRIES = 20;
export const REFRESH_DELAY_MS = 700;

/**
 * store — список просмотренного (ids()), api — api.related(ids), onUpdate — что сделать, когда данные обновились
 * в фоне (перерисовать значок и открытую страницу).
 */
export function createRelated({ store, api, onUpdate }) {
  let data = null;
  let ids = new Set(); // тайтлы, связанные с просмотренными (для отметок в сезонной сетке)
  let loadedKey = "";
  let pending = null;
  let pendingKey = "";
  let retryKey = "";
  let retries = 0;

  const listKey = () => store.ids().sort((a, b) => a - b).join(",");

  const refresh = () =>
    load()
      .then(onUpdate)
      .catch(() => {
        /* вкладка анонсов сама покажет ошибку, когда её откроют */
      });

  // Сервер за один вызов докачивает ограниченное число тайтлов, поэтому неполный ответ запрашиваем повторно.
  function scheduleRetry(key) {
    if (retryKey !== key) {
      retryKey = key;
      retries = 0;
    }
    if (retries >= MAX_RETRIES) return;
    retries += 1;
    setTimeout(() => {
      if (listKey() === key) refresh();
    }, RETRY_MS);
  }

  function load() {
    const key = listKey();
    if (!key) {
      data = { items: [], degraded: false };
      ids = new Set();
      loadedKey = "";
      return Promise.resolve(data);
    }
    if (data && loadedKey === key && !data.degraded && !data.incomplete) return Promise.resolve(data);
    if (pending && pendingKey === key) return pending;

    pendingKey = key;
    pending = api
      .related(store.ids())
      .then((result) => {
        if (listKey() !== key) return load(); // список изменился, пока шёл запрос
        data = result;
        loadedKey = key;
        // «★» ставится по всем связанным тайтлам, в том числе уже вышедшим, а не только по анонсам
        ids = new Set([...result.items.map((i) => i.id), ...(result.linked || [])]);
        if (result.incomplete) scheduleRetry(key);
        return result;
      })
      .finally(() => {
        if (pendingKey === key) pending = null;
      });
    return pending;
  }

  return {
    load,
    listKey,
    /** Фоновое обновление отметок после изменения списка: несколько правок подряд дают один запрос. */
    refreshSoon: debounce(refresh, REFRESH_DELAY_MS),
    get ids() {
      return ids;
    },
    get data() {
      return data;
    },
  };
}
