import { api } from "../api.js";
import { store } from "../store.js";
import { coverEl } from "../ui/card.js";
import { titleSuggest } from "../ui/titlesuggest.js";
import { drawWheel, spinTo } from "../ui/wheelcanvas.js";
import { playStop, playTick, primeWheelSound } from "../ui/wheelsound.js";
import { toast } from "../ui/toast.js";
import { MODES, WHEEL_MAX_ITEMS, WHEEL_PLANNED_MAX, addItem, cleanItem, loadWheel, pickIndex, sample, saveWheel } from "../wheellist.js";
import { fill, h } from "../util.js";

/**
 * «Рулетка»: колесо выбирает случайный тайтл. Список — либо свой (тайтлы из поиска по каталогу),
 * либо автоматически из «Хочу посмотреть».
 */
export function renderWheel(root) {
  const state = loadWheel();
  let rotation = 0; // текущий угол колеса, чтобы повторный запуск продолжал с того же места
  let spinning = null; // { cancel } идущего вращения
  let winner = null; // последний выпавший тайтл
  let planned = { status: "idle", items: [], total: 0, error: "" }; // «Хочу посмотреть» для режима planned
  let plannedRequest = null;

  const canvas = h("canvas", { class: "wheel-canvas", "aria-hidden": "true" });
  const pointer = h("div", { class: "wheel-pointer", "aria-hidden": "true" });
  const current = h("p", { class: "wheel-current" });
  const result = h("div", { class: "wheel-result", role: "status", "aria-live": "polite" });
  const spinBtn = h("button", { class: "btn btn-primary wheel-spin", type: "button", onclick: spin }, "Крутить");
  const suggest = titleSuggest({ onPick: add, isAdded: (id) => state.items.some((x) => x.id === id) });
  const modeBar = h("div", { class: "wheel-modes", role: "group", "aria-label": "Откуда брать тайтлы" });
  const customOnly = h("div", { class: "wheel-custom" }, suggest.el);
  const note = h("p", { class: "wheel-note" });
  const list = h("ul", { class: "wheel-list" });
  const count = h("p", { class: "result-count" });
  const removeBox = h("input", { type: "checkbox", checked: state.removeWinner, onchange: () => setOption("removeWinner", removeBox.checked) });
  const removeOpt = h("label", { class: "wheel-opt" }, removeBox, "Убирать выпавшее из списка");
  const muteBox = h("input", { type: "checkbox", checked: state.mute, onchange: () => setOption("mute", muteBox.checked) });
  const clearBtn = h("button", { class: "btn btn-danger", type: "button", onclick: clearAll }, "Очистить список");

  fill(
    root,
    h("h1", { class: "page-title" }, "Рулетка"),
    h("p", { class: "lead" }, "Колесо выберет случайный тайтл: из списка, который вы соберёте сами, или из «Хочу посмотреть»."),
    h(
      "div",
      { class: "wheel-layout" },
      h("div", { class: "wheel-stage" }, h("div", { class: "wheel-holder" }, h("div", { class: "wheel-disc" }, canvas), pointer), current, spinBtn, result),
      h(
        "div",
        { class: "wheel-side" },
        modeBar,
        customOnly,
        note,
        count,
        list,
        h("div", { class: "wheel-add-row" }, clearBtn),
        removeOpt,
        h("label", { class: "wheel-opt" }, muteBox, "Без звука"),
      ),
    ),
  );

  /** Тайтлы, которые сейчас на колесе. */
  const items = () => (state.mode === "planned" ? planned.items : state.items);

  function setOption(key, value) {
    state[key] = value;
    saveWheel(state);
  }

  function setMode(mode) {
    if (spinning || mode === state.mode) return;
    state.mode = mode;
    saveWheel(state);
    resetResult();
    if (mode === "planned") loadPlanned();
    repaint();
  }

  function resetResult() {
    winner = null;
    result.replaceChildren();
  }

  async function loadPlanned() {
    plannedRequest?.abort();
    const ids = store.plannedIds();
    planned = { status: ids.length ? "loading" : "ready", items: [], total: ids.length, error: "" };
    if (!ids.length) return;
    const request = new AbortController();
    plannedRequest = request;
    repaint();
    try {
      const data = await api.titles(ids, request.signal);
      const all = data.items.map(cleanItem).filter(Boolean);
      planned = { status: "ready", items: sample(all, WHEEL_PLANNED_MAX, pickIndex), total: all.length, error: "" };
    } catch (err) {
      if (err.name === "AbortError") return;
      planned = { status: "error", items: [], total: ids.length, error: err.message };
    }
    if (state.mode === "planned" && !spinning) repaint();
  }

  function repaintModes() {
    fill(
      modeBar,
      ...Object.entries(MODES).map(([id, label]) =>
        h("button", { class: "btn wheel-mode", type: "button", "aria-pressed": String(state.mode === id), disabled: Boolean(spinning), onclick: () => setMode(id) }, label),
      ),
    );
  }

  function emptyText() {
    if (state.mode === "custom") return "Найдите аниме в поле выше и добавьте хотя бы два тайтла, чтобы крутить.";
    if (planned.status === "loading") return "Загружаем «Хочу посмотреть»…";
    if (planned.status === "error") return `Не удалось загрузить список: ${planned.error}`;
    if (!planned.total) return "В «Хочу посмотреть» пока пусто. Отмечайте тайтлы закладкой на карточках, и они появятся здесь.";
    return "Для рулетки нужно хотя бы два тайтла в «Хочу посмотреть».";
  }

  function repaint(highlight = -1) {
    const custom = state.mode === "custom";
    const shown = items();
    const n = shown.length;
    drawWheel(canvas, shown.map((x) => x.title), highlight);
    repaintModes();
    customOnly.hidden = !custom;
    removeOpt.hidden = !custom;
    clearBtn.hidden = !custom;
    clearBtn.disabled = !n || Boolean(spinning);
    spinBtn.disabled = n < 2 || Boolean(spinning);
    spinBtn.title = n < 2 ? "Нужно хотя бы два тайтла" : "";
    if (custom) {
      note.textContent = "";
      count.textContent = n ? `В списке: ${n} из ${WHEEL_MAX_ITEMS}` : "Список пуст";
    } else {
      const cut = planned.total > n && n > 0 ? ` В колесе ${n} случайных из ${planned.total}.` : "";
      note.textContent = `Список берётся из «Хочу посмотреть» автоматически.${cut}`;
      count.textContent = planned.status === "ready" && planned.total ? `В «Хочу посмотреть»: ${planned.total}` : "";
    }
    if (n < 2) current.textContent = emptyText();
    else if (!spinning && !winner) current.textContent = "";
    fill(
      list,
      ...shown.map((item, i) =>
        h(
          "li",
          { class: "wheel-item" },
          coverEl(item, "cover cover-xs"),
          h("a", { class: "wheel-item-name", href: `#/title/${item.id}`, title: item.title }, item.title),
          custom
            ? h("button", { class: "icon-btn wheel-item-del", type: "button", "aria-label": `Убрать «${item.title}»`, disabled: Boolean(spinning), onclick: () => remove(i) }, "×")
            : null,
        ),
      ),
    );
  }

  function commit() {
    saveWheel(state);
    repaint();
  }

  /** Вызывается полем поиска: false — тайтл не добавлен (поле оставляет результаты как есть). */
  function add(item) {
    if (spinning) return false;
    const out = addItem(state.items, item);
    if (out.status === "full") {
      toast(`В списке может быть не больше ${WHEEL_MAX_ITEMS} тайтлов.`, "error");
      return false;
    }
    if (out.status !== "added") return false;
    state.items = out.items;
    resetResult();
    commit();
    return true;
  }

  function remove(i) {
    if (spinning) return;
    state.items.splice(i, 1);
    resetResult();
    commit();
  }

  function clearAll() {
    if (spinning || !state.items.length) return;
    if (!window.confirm("Очистить весь список рулетки?")) return;
    state.items = [];
    resetResult();
    commit();
  }

  async function spin() {
    const wheel = [...items()];
    const n = wheel.length;
    if (n < 2 || spinning) return;
    primeWheelSound();
    resetResult();
    const idx = pickIndex(n);
    drawWheel(canvas, wheel.map((x) => x.title)); // сбрасываем подсветку прошлого результата
    const onCross = (i) => {
      current.textContent = wheel[i].title;
      if (!state.mute) playTick();
    };
    spinning = spinTo(canvas, n, idx, { onCross, startDeg: rotation });
    repaint();
    const end = await spinning.promise;
    spinning = null;
    if (end === null) return; // ушли со страницы
    rotation = end;
    winner = wheel[idx];
    if (!state.mute) playStop();
    current.textContent = winner.title;
    showResult(idx);
    repaint(idx);
  }

  function showResult(idx) {
    const parts = [
      h("span", { class: "wheel-result-label" }, "Выпало"),
      h("a", { class: "wheel-result-name", href: `#/title/${winner.id}` }, winner.title),
    ];
    if (state.mode === "custom" && state.removeWinner) {
      state.items.splice(idx, 1);
      saveWheel(state);
      parts.push(h("span", { class: "wheel-result-note" }, "Убрано из списка"));
    }
    if (state.mode === "planned") {
      const done = h("button", { class: "btn", type: "button" }, "Отметить просмотренным");
      done.onclick = () => {
        if (!store.toggle(winner.id)) return toast("В списке просмотренного слишком много тайтлов.", "error");
        done.replaceWith(h("span", { class: "wheel-result-note" }, "Перенесено в «Просмотрено»"));
      };
      parts.push(done);
    }
    fill(result, ...parts);
  }

  if (state.mode === "planned") loadPlanned();
  repaint();

  return {
    cleanup: () => {
      spinning?.cancel();
      plannedRequest?.abort();
    },
  };
}
