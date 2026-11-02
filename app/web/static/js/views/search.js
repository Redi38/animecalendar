import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { errorBox } from "../ui/error.js";
import { clear, formatTitles, h } from "../util.js";

export function renderSearch(root, { q }, ctx, isCurrent) {
  clear(root).append(
    h("h1", { class: "page-title" }, "Поиск"),
    h("p", { class: "lead" }, `Запрос: «${q}»`),
  );
  const body = h("div", null, h("div", { class: "loading", role: "status" }, "Ищем…"));
  root.append(body);

  const controller = new AbortController();
  api
    .search(q, true, controller.signal)
    .then((data) => {
      if (!isCurrent()) return;
      if (!data.items.length) {
        clear(body).append(
          h(
            "div",
            { class: "empty" },
            "Ничего не нашлось. Попробуйте другое написание: можно искать по русскому, английскому названию и по ромадзи.",
          ),
        );
        return;
      }
      clear(body).append(
        h("p", { class: "result-count" }, `Найдено: ${formatTitles(data.items.length)}`),
        h("div", { class: "grid" }, data.items.map((item) => titleCard(item, { showDate: true, related: ctx.relatedIds.has(item.id) }))),
      );
    })
    .catch((err) => {
      if (err.name === "AbortError" || !isCurrent()) return;
      clear(body).append(errorBox(err.message, { onRetry: () => renderSearch(root, { q }, ctx, isCurrent) }));
    });

  return { cleanup: () => controller.abort() };
}
