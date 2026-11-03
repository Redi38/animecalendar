import { api } from "../api.js";
import { store } from "../store.js";
import { clear, debounce, formatStart, h } from "../util.js";
import { coverEl } from "./card.js";
import { closeDialogAnimated } from "./motion.js";

/**
 * Окно «Переименовать тайтл»: поиск по каталогу, клик по результату выбирает его.
 * Resolve: выбранный тайтл из поиска или null, если окно закрыли.
 */
export function replaceDialog({ current, query }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    let controller = null;
    let lastQuery = "";
    let picked = null;

    const results = h("div", { class: "pick-list", role: "listbox", "aria-label": "Результаты поиска" });
    const input = h("input", {
      type: "search",
      class: "pick-input",
      value: query,
      placeholder: "Название тайтла",
      "aria-label": "Название тайтла",
      autocomplete: "off",
    });

    function row(item) {
      const meta = [item.format_ru, item.season_label || formatStart(item.start, item.start_precision, "short")]
        .filter(Boolean)
        .join(" · ");
      return h(
        "button",
        {
          type: "button",
          class: "pick-row",
          role: "option",
          onclick: () => {
            picked = item;
            closeDialogAnimated(dlg, "ok");
          },
        },
        coverEl(item, "cover cover-xs"),
        h(
          "span",
          { class: "sug-text" },
          h("span", { class: "sug-title" }, item.title),
          h("span", { class: "sug-meta" }, [meta, store.has(item.id) ? "уже в списке" : null].filter(Boolean).join(" · ")),
        ),
      );
    }

    async function search() {
      const q = input.value.trim();
      if (q.length < 2 || q === lastQuery) return;
      lastQuery = q;
      controller?.abort();
      controller = new AbortController();
      clear(results).append(h("div", { class: "sug-note", role: "status" }, "Ищем…"));
      try {
        const data = await api.search(q, true, controller.signal);
        if (q !== lastQuery) return;
        const items = data.items.filter((it) => it.id !== current.id);
        clear(results);
        if (items.length) results.append(...items.slice(0, 10).map(row));
        else results.append(h("div", { class: "sug-note" }, "Ничего не нашлось. Попробуйте другое название."));
      } catch (err) {
        if (err.name === "AbortError") return;
        clear(results).append(h("div", { class: "sug-note", role: "alert" }, err.message));
      }
    }
    const run = debounce(search, 450);
    input.addEventListener("input", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        run.cancel();
        search();
      }
    });

    const dlg = h(
      "dialog",
      { class: "replace-dialog", "aria-labelledby": "replace-title" },
      h(
        "div",
        { class: "pick-body" },
        h("h2", { id: "replace-title" }, "Переименовать тайтл"),
        h("p", { class: "confirm-text" }, `Сейчас в списке: «${current.title}». Найдите правильный тайтл и выберите его — место в списке сохранится.`),
        input,
        results,
        h("div", { class: "confirm-actions" }, h("button", { type: "button", class: "btn", onclick: () => closeDialogAnimated(dlg, "cancel") }, "Отмена")),
      ),
    );
    dlg.addEventListener("close", () => {
      controller?.abort();
      run.cancel();
      const chosen = dlg.returnValue === "ok" ? picked : null;
      dlg.remove();
      if (previous && previous.focus) previous.focus();
      resolve(chosen);
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) closeDialogAnimated(dlg, "cancel");
    });
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeDialogAnimated(dlg, "cancel");
    });
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
    input.select();
    search();
  });
}
