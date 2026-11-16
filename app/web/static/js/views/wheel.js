import { drawWheel, spinTo } from "../ui/wheelcanvas.js";
import { playStop, playTick, primeWheelSound } from "../ui/wheelsound.js";
import { toast } from "../ui/toast.js";
import { WHEEL_MAX_ITEMS, WHEEL_MAX_LEN, addNames, loadWheel, pickIndex, saveWheel } from "../wheellist.js";
import { fill, h } from "../util.js";

/** «Рулетка»: пользователь вносит свой список (названия, по одному на строку), колесо выбирает случайное. */
export function renderWheel(root) {
  const state = loadWheel();
  let rotation = 0; // текущий угол колеса, чтобы повторный запуск продолжал с того же места
  let spinning = null; // { cancel } идущего вращения
  let winner = null; // название, выпавшее в последний раз

  const canvas = h("canvas", { class: "wheel-canvas", "aria-hidden": "true" });
  const pointer = h("div", { class: "wheel-pointer", "aria-hidden": "true" });
  const current = h("p", { class: "wheel-current" });
  const result = h("div", { class: "wheel-result", role: "status", "aria-live": "polite" });
  const spinBtn = h("button", { class: "btn btn-primary wheel-spin", type: "button", onclick: spin }, "Крутить");
  const input = h("textarea", {
    class: "wheel-input",
    rows: "3",
    maxlength: String(WHEEL_MAX_ITEMS * (WHEEL_MAX_LEN + 1)),
    placeholder: "Название аниме. Можно вставить сразу несколько, по одному на строку",
    "aria-label": "Добавить в список рулетки",
  });
  const addBtn = h("button", { class: "btn", type: "button", onclick: add }, "Добавить");
  const list = h("ul", { class: "wheel-list" });
  const count = h("p", { class: "result-count" });
  const removeBox = h("input", { type: "checkbox", checked: state.removeWinner, onchange: () => setOption("removeWinner", removeBox.checked) });
  const muteBox = h("input", { type: "checkbox", checked: state.mute, onchange: () => setOption("mute", muteBox.checked) });
  const clearBtn = h("button", { class: "btn btn-danger", type: "button", onclick: clearAll }, "Очистить список");

  fill(
    root,
    h("h1", { class: "page-title" }, "Рулетка"),
    h("p", { class: "lead" }, "Внесите свой список: что посмотреть сегодня или из чего выбрать. Колесо выберет случайное название. Список хранится в этом браузере."),
    h(
      "div",
      { class: "wheel-layout" },
      h("div", { class: "wheel-stage" }, h("div", { class: "wheel-holder" }, h("div", { class: "wheel-disc" }, canvas), pointer), current, spinBtn, result),
      h(
        "div",
        { class: "wheel-side" },
        input,
        h("div", { class: "wheel-add-row" }, addBtn, clearBtn),
        count,
        list,
        h("label", { class: "wheel-opt" }, removeBox, "Убирать выпавшее из списка"),
        h("label", { class: "wheel-opt" }, muteBox, "Без звука"),
      ),
    ),
  );

  input.addEventListener("keydown", (e) => {
    // Enter добавляет, Shift+Enter переводит строку (для вставки нескольких названий).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      add();
    }
  });

  function setOption(key, value) {
    state[key] = value;
    saveWheel(state);
  }

  function repaint(highlight = -1) {
    drawWheel(canvas, state.items, highlight);
    const n = state.items.length;
    count.textContent = n ? `В списке: ${n} из ${WHEEL_MAX_ITEMS}` : "Список пуст";
    spinBtn.disabled = n < 2 || Boolean(spinning);
    spinBtn.title = n < 2 ? "Добавьте в список хотя бы два названия" : "";
    clearBtn.disabled = !n || Boolean(spinning);
    if (n < 2) current.textContent = "Добавьте хотя бы два названия, чтобы крутить";
    else if (!spinning && !winner) current.textContent = "";
    fill(
      list,
      ...state.items.map((name, i) =>
        h(
          "li",
          { class: "wheel-item" },
          h("span", { class: "wheel-item-name", title: name }, name),
          h("button", { class: "icon-btn wheel-item-del", type: "button", "aria-label": `Убрать «${name}»`, disabled: Boolean(spinning), onclick: () => remove(i) }, "×"),
        ),
      ),
    );
  }

  function commit(highlight = -1) {
    saveWheel(state);
    repaint(highlight);
  }

  function add() {
    if (spinning) return;
    const { items, added, skipped } = addNames(state.items, input.value);
    if (!added && !input.value.trim()) return;
    if (!added) {
      toast(items.length >= WHEEL_MAX_ITEMS ? `В списке может быть не больше ${WHEEL_MAX_ITEMS} названий.` : "Такое название уже есть.", "error");
      return;
    }
    state.items = items;
    input.value = "";
    winner = null;
    result.replaceChildren();
    commit();
    if (skipped) toast(`Добавлено ${added}, пропущено повторов или лишних: ${skipped}.`);
    input.focus();
  }

  function remove(i) {
    if (spinning) return;
    state.items.splice(i, 1);
    winner = null;
    result.replaceChildren();
    commit();
  }

  function clearAll() {
    if (spinning || !state.items.length) return;
    if (!window.confirm("Очистить весь список рулетки?")) return;
    state.items = [];
    winner = null;
    result.replaceChildren();
    commit();
  }

  async function spin() {
    const n = state.items.length;
    if (n < 2 || spinning) return;
    primeWheelSound();
    result.replaceChildren();
    winner = null;
    const idx = pickIndex(n);
    const names = [...state.items];
    drawWheel(canvas, names); // сбрасываем подсветку прошлого результата
    const onCross = (i) => {
      current.textContent = names[i];
      if (!state.mute) playTick();
    };
    spinning = spinTo(canvas, n, idx, { onCross, startDeg: rotation });
    repaint();
    const end = await spinning.promise;
    spinning = null;
    if (end === null) return; // ушли со страницы
    rotation = end;
    winner = names[idx];
    if (!state.mute) playStop();
    current.textContent = winner;
    drawWheel(canvas, names, idx);
    showResult(idx);
    repaint(idx);
  }

  function showResult(idx) {
    const parts = [h("span", { class: "wheel-result-label" }, "Выпало"), h("strong", { class: "wheel-result-name" }, winner)];
    if (state.removeWinner) {
      state.items.splice(idx, 1);
      saveWheel(state);
      parts.push(h("span", { class: "wheel-result-note" }, "Убрано из списка"));
    }
    fill(result, ...parts);
  }

  repaint();

  return {
    cleanup: () => spinning?.cancel(),
  };
}
