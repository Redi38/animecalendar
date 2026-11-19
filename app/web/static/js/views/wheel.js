import { api } from "../api.js";
import { actionMenu } from "../ui/actionmenu.js";
import { store } from "../store.js";
import { coverEl } from "../ui/card.js";
import { titleSuggest } from "../ui/titlesuggest.js";
import { drawWheel, spinTo } from "../ui/wheelcanvas.js";
import { fitWheel } from "../ui/wheelfit.js";
import { playStop, playTick, primeWheelSound } from "../ui/wheelsound.js";
import { toast } from "../ui/toast.js";
import { segmented } from "../ui/segmented.js";
import { MODES, WHEEL_MAX_ITEMS, WHEEL_PLANNED_MAX, addItem, cleanItem, loadWheel, pickIndex, sample, saveWheel } from "../wheellist.js";
import { fill, h } from "../util.js";

const SVG = (body) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const SPEAKER = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>';
const ICON_VOLUME = SVG(`${SPEAKER}<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>`);
const ICON_CHEVRON = '<svg class="wheel-dock-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const ICON_TRASH = SVG('<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>').replace('width="24" height="24"', 'width="16" height="16"');
const ICON_MUTED = SVG(`${SPEAKER}<line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`);

/**
 * «Рулетка»: колесо выбирает случайный тайтл. Список — либо свой (тайтлы из поиска по каталогу),
 * либо автоматически из «Хочу посмотреть».
 */
export function renderWheel(root) {
  const state = loadWheel();
  let rotation = 0; // текущий угол колеса, чтобы повторный запуск продолжал с того же места
  let spinning = null; // { cancel } идущего вращения
  let winner = null; // последний выпавший тайтл
  let openTimer = 0; // таймер автоматического открытия карточки после остановки колеса
  let planned = { status: "idle", items: [], total: 0, error: "" }; // «Хочу посмотреть» для режима planned
  let plannedRequest = null;

  const canvas = h("canvas", { class: "wheel-canvas", "aria-hidden": "true" });
  const pointer = h("div", { class: "wheel-pointer", "aria-hidden": "true" });
  const stage = h("div", { class: "wheel-stage" });
  const holder = h("div", { class: "wheel-holder" }, h("div", { class: "wheel-disc" }, canvas), pointer);
  const current = h("p", { class: "wheel-current" });
  const result = h("div", { class: "wheel-result", role: "status", "aria-live": "polite" });
  const spinBtn = h("button", { class: "btn btn-primary wheel-spin", type: "button", onclick: spin }, "🎲 Крутить");
  const suggest = titleSuggest({ onPick: add, isAdded: (id) => state.items.some((x) => x.id === id) });
  const modeToggle = segmented({ options: Object.entries(MODES), value: state.mode, label: "Откуда брать тайтлы", onChange: setMode });
  const summary = h("span", { class: "wheel-dock-summary" });
  const dockToggle = h(
    "button",
    { class: "wheel-dock-toggle", type: "button", "aria-expanded": "false", onclick: toggleDock },
    h("span", { class: "wheel-dock-heading" }, h("span", null, "Настройки рулетки"), summary),
  );
  dockToggle.insertAdjacentHTML("beforeend", ICON_CHEVRON);
  const dockBody = h("div", { class: "wheel-dock-body" }, h("div", { class: "wheel-dock-inner" }, h("p", { class: "wheel-dock-caption" }, "Откуда брать тайтлы"), modeToggle.el));
  const dock = h("div", { class: "wheel-dock" }, dockToggle, dockBody, spinBtn);
  const customOnly = h("div", { class: "wheel-custom" }, suggest.el);
  const note = h("p", { class: "wheel-note" });
  const list = h("ul", { class: "wheel-list" });
  const count = h("p", { class: "result-count" });
  const muteBtn = h("button", { class: "wheel-mute-btn", type: "button", onclick: toggleMute });
  // «Очистить» открывает маленькое меню с одним пунктом: нажатие на него и есть подтверждение.
  const trashIcon = h("span", { class: "wheel-clear-icon", "aria-hidden": "true" });
  trashIcon.innerHTML = ICON_TRASH;
  const clearMenu = actionMenu({
    rootClass: "wheel-clear-menu",
    listClass: "list-menu-list wheel-clear-list",
    trigger: { props: { class: "wheel-clear" }, content: [trashIcon, h("span", null, "Очистить")] },
    actions: () => [{ label: `Очистить весь список (${state.items.length})`, danger: true, run: clearAll }],
    stopEscape: true,
  });
  const clearBtn = clearMenu.querySelector("button");
  const head = h("div", { class: "wheel-list-head" }, count, clearMenu);

  stage.append(holder, current, result);
  fill(
    root,
    h("h1", { class: "page-title" }, "Рулетка"),
    h("p", { class: "lead" }, "Колесо выберет случайный тайтл: из списка, который вы соберёте сами, или из «Хочу посмотреть»."),
    h(
      "div",
      { class: "wheel-layout" },
      muteBtn,
      dock,
      stage,
      h(
        "div",
        { class: "wheel-side" },
        customOnly,
        note,
        head,
        list,
      ),
    ),
  );

  /** Тайтлы, которые сейчас на колесе. */
  const items = () => (state.mode === "planned" ? planned.items : state.items);

  function toggleMute() {
    state.mute = !state.mute;
    saveWheel(state);
    paintMute();
  }

  /** Кнопка звука: иконка и подпись показывают, что случится по нажатию. */
  function paintMute() {
    const label = state.mute ? "Включить звук колеса" : "Выключить звук колеса";
    muteBtn.innerHTML = state.mute ? ICON_MUTED : ICON_VOLUME;
    muteBtn.classList.toggle("muted", state.mute);
    muteBtn.setAttribute("aria-label", label);
    muteBtn.title = label;
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
    clearTimeout(openTimer);
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

  function toggleDock() {
    const open = dockToggle.getAttribute("aria-expanded") !== "true";
    dockToggle.setAttribute("aria-expanded", String(open));
    dock.classList.toggle("open", open);
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
    modeToggle.set(state.mode, Boolean(spinning));
    const n2 = state.mode === "custom" ? `${n} из ${WHEEL_MAX_ITEMS}` : planned.status === "ready" ? `${planned.total}` : "…";
    summary.textContent = `${MODES[state.mode]} · ${n2}`;
    customOnly.hidden = !custom;
    clearMenu.hidden = !custom;
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
    current.textContent = "";
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
    current.textContent = "";
    showResult();
    repaint(idx);
  }

  /** Карточка тайтла открывается поверх колеса, как при нажатии на постер; закрыли её, и колесо можно крутить снова. */
  function openCard(id) {
    location.hash = `#/title/${id}`;
  }

  function showResult() {
    const item = winner;
    const again = h(
      "button",
      { class: "wheel-card-head", type: "button", title: "Открыть карточку", onclick: () => openCard(item.id) },
      coverEl(item, "cover cover-sm"),
      h("span", { class: "wheel-card-text" }, h("span", { class: "wheel-card-label" }, "Выпало"), h("span", { class: "wheel-card-title" }, item.title)),
    );
    result.replaceChildren(h("div", { class: "wheel-card" }, again));
    // Даём секунду увидеть подсвеченный сегмент, потом открываем карточку.
    openTimer = setTimeout(() => openCard(item.id), 600);
  }

  if (state.mode === "planned") loadPlanned();
  paintMute();
  repaint();
  const stopFit = fitWheel({ holder, stage, dockBody });

  return {
    cleanup: () => {
      stopFit();
      clearTimeout(openTimer);
      spinning?.cancel();
      plannedRequest?.abort();
    },
  };
}
