import { api } from "../api.js";
import { clear, debounce, h, formatStart } from "../util.js";
import { coverEl, watchButton } from "./card.js";

/** Поле поиска в шапке: подсказки при наборе, Enter — страница с полными результатами. */
export function initSearch() {
  const input = document.getElementById("search-input");
  const panel = document.getElementById("search-panel");
  const root = document.getElementById("search");
  let controller = null;
  let lastQuery = "";

  function open() {
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function close() {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    controller?.abort();
  }

  function row(item) {
    const meta = [item.format_ru, item.season_label || formatStart(item.start, item.start_precision, "short")]
      .filter(Boolean)
      .join(" · ");
    return h(
      "div",
      { class: "sug", role: "option" },
      h(
        "a",
        { class: "sug-link", href: `#/title/${item.id}`, onclick: close },
        coverEl(item, "cover cover-xs"),
        h("span", { class: "sug-text" }, h("span", { class: "sug-title" }, item.title), h("span", { class: "sug-meta" }, meta)),
      ),
      watchButton(item),
    );
  }

  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      close();
      return;
    }
    lastQuery = q;
    controller?.abort();
    controller = new AbortController();
    open();
    clear(panel).append(h("div", { class: "sug-note", role: "status" }, "Ищем…"));
    try {
      const data = await api.search(q, false, controller.signal);
      if (q !== lastQuery) return;
      clear(panel);
      if (!data.items.length) {
        panel.append(h("div", { class: "sug-note" }, "Среди загруженных тайтлов ничего нет."));
      } else {
        panel.append(...data.items.slice(0, 8).map(row));
      }
      panel.append(
        h("a", { class: "sug-all", href: `#/search/${encodeURIComponent(q)}`, onclick: close }, `Искать «${q}» везде`),
      );
    } catch (err) {
      if (err.name === "AbortError") return;
      clear(panel).append(h("div", { class: "sug-note", role: "alert" }, err.message));
    }
  }, 250);

  input.addEventListener("input", run);
  input.addEventListener("focus", () => {
    if (panel.childElementCount) open();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const q = input.value.trim();
      if (q.length >= 2) {
        event.preventDefault();
        close();
        location.hash = `#/search/${encodeURIComponent(q)}`;
        input.blur();
      }
    } else if (event.key === "Escape") {
      close();
    } else if (event.key === "ArrowDown") {
      panel.querySelector("a")?.focus();
      event.preventDefault();
    }
  });
  panel.addEventListener("keydown", (event) => {
    const focusables = [...panel.querySelectorAll("a, button")];
    const i = focusables.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      focusables[Math.min(i + 1, focusables.length - 1)]?.focus();
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      if (i <= 0) input.focus();
      else focusables[i - 1].focus();
      event.preventDefault();
    } else if (event.key === "Escape") {
      close();
      input.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) close();
  });

  return {
    reset() {
      input.value = "";
      clear(panel);
      close();
    },
    setValue(value) {
      input.value = value;
    },
  };
}
