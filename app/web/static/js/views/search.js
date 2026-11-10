import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { groupSection } from "../ui/group.js";
import { createLoader } from "../loader.js";
import { fill, formatTitles, h } from "../util.js";

export function renderSearch(root, { q }, ctx, isCurrent) {
  fill(
    root,
    h("h1", { class: "page-title" }, "Поиск"),
    h("p", { class: "lead" }, `Запрос: «${q}»`),
  );
  const body = h("div", null);
  root.append(body);

  const loader = createLoader(isCurrent);
  loader.load(body, (signal) => api.search(q, true, signal), {
    loading: "Ищем…",
    onData: (data) => {
      if (!data.items.length) {
        fill(
          body,
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
      fill(body, ...parts);
    },
  });

  return { cleanup: loader.abort };
}
