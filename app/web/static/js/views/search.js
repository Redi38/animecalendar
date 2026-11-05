import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { groupSection } from "../ui/group.js";
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
      const card = (item) => titleCard(item, { showDate: true, related: ctx.relatedIds.has(item.id) });
      const groups = data.groups || [];
      const parts = [h("p", { class: "result-count" }, `Найдено: ${formatTitles(data.items.length)}`)];
      // Сначала франшизы целиком (первая раскрыта), потом отдельные тайтлы, которые нашёл поиск.
      if (groups.length) {
        parts.push(
          h("h2", { class: "day-title" }, "Франшизы"),
          ...groups.map((g, i) => groupSection({ group: g, items: g.members, renderItem: card, open: i === 0 })),
          h("h2", { class: "day-title" }, "Найденные тайтлы"),
        );
      }
      parts.push(h("div", { class: "grid" }, data.items.map(card)));
      clear(body).append(...parts);
    })
    .catch((err) => {
      if (err.name === "AbortError" || !isCurrent()) return;
      clear(body).append(errorBox(err.message, { onRetry: () => renderSearch(root, { q }, ctx, isCurrent) }));
    });

  return { cleanup: () => controller.abort() };
}
