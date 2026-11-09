import { api } from "../api.js";
import { groupByYear } from "../studiogroups.js";
import { titleCard } from "../ui/card.js";
import { errorBox } from "../ui/error.js";
import { fill, formatTitles, h } from "../util.js";

/** Страница студии: все тайтлы, где она главная, по годам от новых к старым. Страницы подгружаются кнопкой. */
export function renderStudio(root, { id }, ctx, isCurrent) {
  const controller = new AbortController();
  const title = h("h1", { class: "page-title" }, "Студия");
  const list = h("div", null);
  const more = h("div", { class: "load-more" });
  let name = null;
  let items = [];
  let page = 0; // последняя загруженная страница
  let hasNext = false;
  let loading = false;

  fill(
    root,
    h("a", { class: "back-link", href: "#/" }, "← Афиша"),
    title,
    h("p", { class: "lead" }, "Все тайтлы, где эта студия главная, от новых к старым."),
    list,
    more,
  );

  function paint() {
    title.textContent = name || "Студия";
    if (!items.length) {
      fill(list, h("div", { class: "empty" }, "У этой студии пока нет тайтлов в каталоге."));
      return;
    }
    const count = h("p", { class: "result-count" }, hasNext ? `Показано: ${formatTitles(items.length)}` : formatTitles(items.length));
    const sections = groupByYear(items).map((group) =>
      h(
        "section",
        { class: "year-section" },
        h("h2", { class: "year-heading" }, group.label, h("span", { class: "year-count" }, String(group.items.length))),
        h(
          "div",
          { class: "grid" },
          group.items.map((item) => titleCard(item, { showDate: true })),
        ),
      ),
    );
    fill(list, count, ...sections);
  }

  function paintMore(error = null) {
    fill(
      more,
      error ? h("div", { class: "notice", role: "alert" }, error) : null,
      hasNext || error
        ? h(
            "button",
            { type: "button", class: "btn", disabled: loading, onclick: () => load(page + 1) },
            loading ? "Загружаем…" : error ? "Повторить" : "Показать ещё",
          )
        : null,
    );
  }

  async function load(next) {
    if (loading) return;
    loading = true;
    if (next === 1) fill(list, h("div", { class: "loading", role: "status" }, "Загружаем тайтлы студии…"));
    else paintMore();
    try {
      const data = await api.studio(id, next, controller.signal);
      if (!isCurrent()) return;
      const known = new Set(items.map((i) => i.id));
      items = [...items, ...data.items.filter((i) => !known.has(i.id))];
      name = data.name;
      page = data.page;
      hasNext = data.has_next;
      loading = false;
      paint();
      paintMore();
    } catch (err) {
      if (err.name === "AbortError" || !isCurrent()) return;
      loading = false;
      if (next === 1) {
        fill(
          list,
          errorBox(err.status === 404 ? "Такой студии не нашлось." : err.message, { onRetry: err.status === 404 ? null : () => load(1) }),
        );
      } else {
        paintMore(err.message);
      }
    }
  }

  load(1);

  return {
    cleanup: () => controller.abort(),
    refresh: () => {
      if (isCurrent() && items.length) paint();
    },
  };
}
