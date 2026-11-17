import { api } from "../api.js";
import { clear, debounce, fill, formatStart, h } from "../util.js";
import { coverEl } from "./card.js";

/**
 * Поле поиска по каталогу, как в шапке сайта, но результат не открывается, а выбирается: клик по строке
 * (или Enter для первого результата) вызывает onPick(item). isAdded(id) помечает тайтлы, которые уже выбраны.
 */
export function titleSuggest({ onPick, isAdded, placeholder = "Найти аниме по названию" }) {
  let controller = null;
  let lastQuery = "";
  let results = [];

  const input = h("input", {
    type: "search",
    class: "pick-input",
    placeholder,
    "aria-label": placeholder,
    autocomplete: "off",
    role: "combobox",
    "aria-expanded": "false",
  });
  const panel = h("div", { class: "pick-list wheel-suggest-list", role: "listbox", "aria-label": "Результаты поиска", hidden: true });

  function row(item) {
    const meta = [item.format_ru, item.season_label || formatStart(item.start, item.start_precision, "short")].filter(Boolean).join(" · ");
    const added = isAdded(item.id);
    return h(
      "button",
      { type: "button", class: "pick-row", role: "option", disabled: added, onclick: () => pick(item) },
      coverEl(item, "cover cover-xs"),
      h(
        "span",
        { class: "sug-text" },
        h("span", { class: "sug-title" }, item.title),
        h("span", { class: "sug-meta" }, [meta, added ? "уже в рулетке" : null].filter(Boolean).join(" · ")),
      ),
    );
  }

  function show(content) {
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    fill(panel, ...content);
  }

  function hide() {
    controller?.abort();
    lastQuery = "";
    results = [];
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    clear(panel);
  }

  function pick(item) {
    if (onPick(item) === false) return;
    show(results.map(row)); // обновляем пометки «уже в рулетке»
  }

  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) return hide();
    if (q === lastQuery) return;
    lastQuery = q;
    controller?.abort();
    controller = new AbortController();
    show([h("div", { class: "sug-note", role: "status" }, "Ищем…")]);
    try {
      const data = await api.search(q, false, controller.signal);
      if (q !== lastQuery) return;
      results = data.items.slice(0, 10);
      show(results.length ? results.map(row) : [h("div", { class: "sug-note" }, "Среди загруженных тайтлов ничего нет.")]);
    } catch (err) {
      if (err.name === "AbortError") return;
      show([h("div", { class: "sug-note", role: "alert" }, err.message)]);
    }
  }, 250);

  input.addEventListener("input", run);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = results.find((item) => !isAdded(item.id));
      if (first) pick(first);
    } else if (event.key === "Escape") {
      input.value = "";
      hide();
    } else if (event.key === "ArrowDown") {
      panel.querySelector("button:not([disabled])")?.focus();
      event.preventDefault();
    }
  });
  panel.addEventListener("keydown", (event) => {
    const rows = [...panel.querySelectorAll("button:not([disabled])")];
    const i = rows.indexOf(document.activeElement);
    if (event.key === "ArrowDown") rows[Math.min(i + 1, rows.length - 1)]?.focus();
    else if (event.key === "ArrowUp") (i <= 0 ? input : rows[i - 1]).focus();
    else return;
    event.preventDefault();
  });

  return { el: h("div", { class: "wheel-suggest" }, input, panel), input, reset: () => { input.value = ""; hide(); } };
}
