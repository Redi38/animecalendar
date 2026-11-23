import { actionMenu } from "../ui/actionmenu.js";
import { coverEl } from "../ui/card.js";
import { titleSuggest } from "../ui/titlesuggest.js";
import { drawWheel, prefersReducedMotion, spinTo } from "../ui/wheelcanvas.js";
import { fireWheelConfetti } from "../ui/wheelconfetti.js";
import { wheelFxPanel } from "../ui/wheelfxpanel.js";
import { fitWheel } from "../ui/wheelfit.js";
import { ICON_CHEVRON, ICON_MUTED, ICON_TRASH, ICON_VOLUME } from "../ui/icons.js";
import { startWheelIdle } from "../ui/wheelidle.js";
import { playStop, playTick, primeWheelSound } from "../ui/wheelsound.js";
import { toast } from "../ui/toast.js";
import { segmented } from "../ui/segmented.js";
import { MODES, WHEEL_MAX_ITEMS, addItem, loadWheel, pickIndex, saveWheel } from "../wheellist.js";
import { createPlannedList } from "../wheelplanned.js";
import { loadFx } from "../wheelsettings.js";
import { fill, h } from "../util.js";

/**
 * «Рулетка»: колесо выбирает случайный тайтл. Список — либо свой (тайтлы из поиска по каталогу),
 * либо автоматически из «Хочу посмотреть».
 */
const IDLE_DEG_PER_SEC = 4; // скорость холостого хода колеса
const OPEN_DELAY_MS = 600; // пауза между остановкой колеса и открытием карточки
const CONFETTI_OPEN_DELAY_MS = 1600; // с конфетти пауза дольше, чтобы залп успел увидеть, пока карточка не закрыла колесо

export function renderWheel(root) {
  const state = loadWheel();
  const fx = loadFx(); // скорость вращения, неон, конфетти
  let stopConfetti = null; // убирает идущее конфетти
  let rotation = 0; // текущий угол колеса, чтобы повторный запуск продолжал с того же места
  let spinning = null; // { cancel } идущего вращения
  let winner = null; // последний выпавший тайтл
  let openTimer = 0; // таймер автоматического открытия карточки после остановки колеса
  // «Хочу посмотреть» для режима planned: загрузка, выборка и кэш живут в wheelplanned.js.
  const plannedList = createPlannedList({
    onLoading: () => repaint(),
    onSettled: () => {
      if (state.mode === "planned" && !spinning) repaint();
    },
  });
  let lastTitles = []; // что было нарисовано на колесе в прошлый раз: пока грузится список, колесо не пустеет

  const canvas = h("canvas", { class: "wheel-canvas", "aria-hidden": "true" });
  const pointer = h("div", { class: "wheel-pointer", "aria-hidden": "true" });
  const stage = h("div", { class: "wheel-stage" });
  const holder = h("div", { class: `wheel-holder wheel-holder--${fx.neon ? "neon" : "classic"}` }, h("div", { class: "wheel-disc" }, canvas), pointer);
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
  const fxPanel = wheelFxPanel({ fx, holder, onConfettiOff: () => stopConfetti?.() });
  const dockBody = h(
    "div",
    { class: "wheel-dock-body" },
    h(
      "div",
      { class: "wheel-dock-inner" },
      h("p", { class: "wheel-dock-caption" }, "Откуда брать тайтлы"),
      modeToggle.el,
      h("p", { class: "wheel-dock-caption" }, "Эффекты и скорость"),
      fxPanel.fxRow,
      fxPanel.speedRow,
    ),
  );
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

  // Бегущее название и «Выпало» стоят над колесом, в одной ячейке: высота постоянна, колесо не прыгает.
  const top = h("div", { class: "wheel-top" }, current, result);
  stage.append(top, holder);
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
  const items = () => (state.mode === "planned" ? plannedList.state.items : state.items);

  /** Стрелка дёргается, когда колесо проходит очередной сегмент. */
  function flickPointer() {
    if (prefersReducedMotion()) return;
    pointer.classList.remove("wheel-pointer--flick");
    void pointer.offsetWidth; // перезапуск анимации, если предыдущая ещё идёт
    pointer.classList.add("wheel-pointer--flick");
  }

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
    if (mode === "planned") plannedList.load();
    repaint();
  }

  function resetResult() {
    winner = null;
    clearTimeout(openTimer);
    result.replaceChildren();
  }

  function toggleDock() {
    const open = dockToggle.getAttribute("aria-expanded") !== "true";
    dockToggle.setAttribute("aria-expanded", String(open));
    dock.classList.toggle("open", open);
  }

  function emptyText() {
    if (state.mode === "custom") return "Найдите аниме в поле выше и добавьте хотя бы два тайтла, чтобы крутить.";
    if (plannedList.state.status === "loading") return "Загружаем «Хочу посмотреть»…";
    if (plannedList.state.status === "error") return `Не удалось загрузить список: ${plannedList.state.error}`;
    if (!plannedList.state.total) return "В «Хочу посмотреть» пока пусто. Отмечайте тайтлы закладкой на карточках, и они появятся здесь.";
    return "Для рулетки нужно хотя бы два тайтла в «Хочу посмотреть».";
  }

  /** В покое над колесом показывается тайтл сегмента, который сейчас под стрелкой. */
  function showUnderPointer() {
    const shown = items();
    const n = shown.length;
    if (n < 2) return;
    const idx = Math.floor((360 - (((rotation % 360) + 360) % 360)) % 360 / (360 / n)) % n;
    const title = shown[idx].title;
    if (current.textContent !== title) current.textContent = title;
  }

  function repaint(highlight = -1) {
    const custom = state.mode === "custom";
    const shown = items();
    const n = shown.length;
    const titles = shown.map((x) => x.title);
    if (titles.length) lastTitles = titles;
    // Пока список грузится, оставляем на колесе прежние сегменты (приглушённые), а не рисуем пустое колесо.
    const loading = state.mode === "planned" && plannedList.state.status === "loading";
    drawWheel(canvas, loading && lastTitles.length ? lastTitles : titles, highlight);
    holder.classList.toggle("wheel-holder--loading", loading && lastTitles.length > 0);
    modeToggle.set(state.mode, Boolean(spinning));
    const n2 = state.mode === "custom" ? `${n} из ${WHEEL_MAX_ITEMS}` : plannedList.state.status === "ready" ? `${plannedList.state.total}` : "…";
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
      const cut = plannedList.state.total > n && n > 0 ? ` В колесе ${n} случайных из ${plannedList.state.total}.` : "";
      note.textContent = `Список берётся из «Хочу посмотреть» автоматически.${cut}`;
      count.textContent = plannedList.state.status === "ready" && plannedList.state.total ? `В «Хочу посмотреть»: ${plannedList.state.total}` : "";
    }
    if (n < 2) current.textContent = emptyText();
    else if (!spinning && !winner) showUnderPointer();
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
    const idx = pickIndex(n);
    drawWheel(canvas, wheel.map((x) => x.title)); // сбрасываем подсветку прошлого результата
    current.textContent = wheel[Math.floor((360 - (((rotation % 360) + 360) % 360)) % 360 / (360 / n)) % n].title;
    const onCross = (i) => {
      current.textContent = wheel[i].title;
      flickPointer();
      if (!state.mute) playTick();
    };
    stopConfetti?.();
    spinning = spinTo(canvas, n, idx, { onCross, startDeg: rotation, durationMs: Math.round(fx.speed * 1000) });
    repaint();
    const end = await spinning.promise;
    spinning = null;
    if (end === null) return; // ушли со страницы
    rotation = end;
    winner = wheel[idx];
    if (!state.mute) playStop();
    current.textContent = "";
    const confetti = fx.confetti && !prefersReducedMotion();
    if (confetti) stopConfetti = fireWheelConfetti(holder);
    showResult(confetti ? CONFETTI_OPEN_DELAY_MS : OPEN_DELAY_MS);
    repaint(idx);
  }

  /** Карточка тайтла открывается поверх колеса, как при нажатии на постер; закрыли её, и колесо можно крутить снова. */
  function openCard(id) {
    location.hash = `#/title/${id}`;
  }

  function showResult(openDelay = OPEN_DELAY_MS) {
    const item = winner;
    const again = h(
      "button",
      { class: "wheel-card-head", type: "button", title: "Открыть карточку", onclick: () => openCard(item.id) },
      coverEl(item, "cover cover-sm"),
      h("span", { class: "wheel-card-text" }, h("span", { class: "wheel-card-label" }, "Выпало"), h("span", { class: "wheel-card-title" }, item.title)),
    );
    result.replaceChildren(h("div", { class: "wheel-card" }, again));
    // Даём время увидеть подсвеченный сегмент (и конфетти, если они включены), потом открываем карточку.
    openTimer = setTimeout(() => openCard(item.id), openDelay);
  }

  // Холостой ход: пока колесо никто не крутит и нет результата, оно медленно ползёт.
  const stopIdle = startWheelIdle({
    degPerSec: IDLE_DEG_PER_SEC,
    canDrift: () => !spinning && !winner && !document.hidden,
    onDrift: (deg) => {
      rotation = (rotation + deg) % 360;
      canvas.style.transform = `rotate(${rotation}deg)`;
      showUnderPointer();
    },
  });

  if (state.mode === "planned") plannedList.load();
  paintMute();
  repaint();
  const stopFit = fitWheel({ holder, stage, dockBody });

  return {
    cleanup: () => {
      stopFit();
      stopIdle();
      clearTimeout(openTimer);
      stopConfetti?.();
      spinning?.cancel();
      plannedList.abort();
    },
  };
}
