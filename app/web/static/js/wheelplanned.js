// Список «Хочу посмотреть» для колеса: грузит тайтлы по ID, берёт случайную выборку и помнит последний результат,
// чтобы переключение туда-обратно не мигало. Состояние отдаёт через state: { status, items, total, error }.

import { api } from "./api.js";
import { latestRequest } from "./loader.js";
import { store } from "./store.js";
import { WHEEL_PLANNED_MAX, cleanItem, pickIndex, sample } from "./wheellist.js";

/**
 * onLoading — список пошёл грузиться (можно перерисовать колесо);
 * onSettled — загрузка закончилась (готово или ошибка), отменённая загрузка его не вызывает.
 */
export function createPlannedList({ onLoading, onSettled }) {
  let state = { status: "idle", items: [], total: 0, error: "" };
  let cache = null; // { key, items, total }: уже загруженная выборка для того же набора ID
  const latest = latestRequest();

  async function load() {
    latest.abort();
    const ids = store.plannedIds();
    const key = ids.join(",");
    if (cache?.key === key) {
      // Тот же список, что уже грузили: показываем его сразу и с теми же тайтлами на колесе.
      state = { status: "ready", items: cache.items, total: cache.total, error: "" };
      return;
    }
    state = { status: ids.length ? "loading" : "ready", items: [], total: ids.length, error: "" };
    if (!ids.length) return;
    onLoading();
    await latest.run(
      (signal) => api.titles(ids, signal),
      (data) => {
        const all = data.items.map(cleanItem).filter(Boolean);
        state = { status: "ready", items: sample(all, WHEEL_PLANNED_MAX, pickIndex), total: all.length, error: "" };
        cache = { key, items: state.items, total: state.total };
        onSettled();
      },
      (err) => {
        state = { status: "error", items: [], total: ids.length, error: err.message };
        onSettled();
      },
    );
  }

  return {
    get state() {
      return state;
    },
    load,
    abort: () => latest.abort(),
  };
}
