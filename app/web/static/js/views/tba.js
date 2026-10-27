import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { clear, debounce, h, normalize, plural } from "../util.js";
import { tbaTab } from "./season.js";

/** Анонсы, у которых студия ещё не назвала ни сезон, ни дату выхода. */
export function renderTba(root, ctx, isCurrent) {
  const { meta } = ctx;
  const { current } = meta;
  const state = { text: "", onlyRelated: false };
  let data = null;

  const seasonTabs = meta.seasons.map((s) =>
    h("a", { class: "season-tab", href: `#/season/${current.year}/${s.slug}` }, s.label),
  );
  const nav = h(
    "div",
    { class: "season-nav" },
    h("div", { class: "season-tabs", role: "navigation", "aria-label": "Сезоны и анонсы без даты" }, [...seasonTabs, tbaTab(true)]),
    h("a", { class: "btn btn-ghost", href: `#/season/${current.year}/${current.season.toLowerCase()}` }, "К текущему сезону"),
  );
  const toolbar = h("div", { class: "toolbar" });
  const content = h("div", { class: "season-content" }, h("div", { class: "loading", role: "status" }, "Ищем анонсы без даты…"));
  clear(root).append(
    h("h1", { class: "page-title" }, "Анонсы без даты"),
    h("p", { class: "lead" }, "Тайтлы, у которых студия ещё не объявила ни сезон, ни дату выхода. Показаны самые популярные."),
    nav,
    toolbar,
    content,
  );

  function visibleItems() {
    const words = normalize(state.text).split(" ").filter(Boolean);
    return data.items.filter((item) => {
      if (state.onlyRelated && !ctx.relatedIds.has(item.id)) return false;
      if (!words.length) return true;
      const hay = normalize(`${item.title} ${item.subtitle || ""} ${item.title_native || ""}`);
      return words.every((w) => hay.includes(w));
    });
  }

  function paintToolbar() {
    const filter = h("input", {
      type: "search",
      class: "inline-filter",
      placeholder: "Фильтр по названию среди анонсов",
      "aria-label": "Фильтр по названию среди анонсов",
      value: state.text,
      oninput: debounce((e) => {
        state.text = e.target.value;
        paintList();
      }, 150),
    });
    const related = ctx.relatedIds.size
      ? h(
          "button",
          {
            type: "button",
            class: "filter-chip",
            "aria-pressed": state.onlyRelated ? "true" : "false",
            onclick: () => {
              state.onlyRelated = !state.onlyRelated;
              paintToolbar();
              paintList();
            },
          },
          "★ Связано с моим списком",
        )
      : null;
    const keepFocus = document.activeElement?.classList?.contains("inline-filter");
    clear(toolbar).append(filter, h("div", { class: "chip-row" }, related));
    if (keepFocus) {
      const el = toolbar.querySelector(".inline-filter");
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }

  function paintList() {
    const items = visibleItems();
    const total = data.items.length;
    const count = h(
      "p",
      { class: "result-count", role: "status" },
      items.length === total
        ? `${total} ${plural(total, ["тайтл", "тайтла", "тайтлов"])}`
        : `Показано ${items.length} из ${total}`,
    );
    if (!items.length) {
      clear(content).append(
        count,
        h(
          "div",
          { class: "empty" },
          total
            ? "Под этот фильтр ничего не подошло."
            : "Сейчас анонсов без даты в каталоге нет. Они появляются, когда студии объявляют проект, но не называют срок.",
        ),
      );
      return;
    }
    clear(content).append(
      count,
      h("div", { class: "grid" }, items.map((item) => titleCard(item, { showDate: false, related: ctx.relatedIds.has(item.id) }))),
    );
  }

  paintToolbar();
  const controller = new AbortController();
  api
    .tba(controller.signal)
    .then((loaded) => {
      if (!isCurrent()) return;
      data = loaded;
      paintList();
    })
    .catch((err) => {
      if (err.name === "AbortError" || !isCurrent()) return;
      clear(content).append(
        h(
          "div",
          { class: "error-box", role: "alert" },
          h("p", null, err.message),
          h("button", { type: "button", class: "btn", onclick: () => renderTba(root, ctx, isCurrent) }, "Повторить"),
        ),
      );
    });

  return {
    cleanup: () => controller.abort(),
    refresh: () => {
      if (!data) return;
      paintToolbar();
      paintList();
    },
  };
}
