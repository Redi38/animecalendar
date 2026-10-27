import { titleCard } from "../ui/card.js";
import { capitalize, clear, formatStart, h, plural } from "../util.js";

function groupItems(items) {
  const groups = new Map();
  const add = (key, title, item) => {
    if (!groups.has(key)) groups.set(key, { title, items: [] });
    groups.get(key).items.push(item);
  };
  for (const item of items) {
    if (item.status === "RELEASING") add("0-now", "Выходит сейчас", item);
    else if (item.status === "FINISHED") add("0-recent", "Недавно вышло", item);
    else if (!item.start) add("9-tbd", "Дата не объявлена", item);
    else {
      const key = `1-${item.start.slice(0, item.start_precision === "year" ? 4 : 7)}`;
      const label =
        item.start_precision === "year"
          ? `${item.start} год`
          : capitalize(formatStart(item.start.slice(0, 7), "month"));
      add(key, label, item);
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
}

export function renderUpcoming(root, ctx, isCurrent) {
  const { store } = ctx;
  clear(root).append(h("h1", { class: "page-title" }, "Мои анонсы"));

  if (store.size() === 0) {
    root.append(
      h(
        "div",
        { class: "empty empty-hero" },
        h("h2", null, "Здесь появятся продолжения того, что вы смотрели"),
        h(
          "p",
          null,
          "Отметьте просмотренные тайтлы кнопкой с глазом на карточке или найдите их через поиск. Мы покажем новые сезоны, фильмы и спин-оффы, которые уже анонсированы или выходят прямо сейчас.",
        ),
        h("a", { class: "btn btn-primary", href: "#/" }, "Перейти к сезонам"),
      ),
    );
    return {};
  }

  const body = h("div", null, h("div", { class: "loading", role: "status" }, "Ищем анонсы по вашему списку…"));
  root.append(
    h(
      "p",
      { class: "lead" },
      `Связанные тайтлы по ${store.size()} ${plural(store.size(), ["просмотренному", "просмотренным", "просмотренным"])}. Показываем то, что ещё не вышло, выходит сейчас или вышло за последние 45 дней.`,
    ),
    body,
  );

  // «Новое» — то, что не видели в прошлые визиты. При самом первом визите ничего не подсвечиваем.
  // Обход связей может идти несколькими вызовами, поэтому подсветка копится между перерисовками.
  const firstVisit = !store.seenReady();
  const fresh = new Set();

  function paint(data) {
    if (!firstVisit) {
      for (const item of data.items) if (!store.isSeen(item.id)) fresh.add(item.id);
    }
    store.markSeen(data.items.map((i) => i.id));
    ctx.updateBadge();

    const parts = [];
    if (data.degraded) {
      parts.push(
        h(
          "div",
          { class: "notice", role: "status" },
          "AniList сейчас отвечает не на все запросы, поэтому список может быть неполным. Обновите страницу чуть позже.",
        ),
      );
    }
    if (data.incomplete) {
      parts.push(
        h(
          "div",
          { class: "notice", role: "status" },
          "Связи по вашему списку ещё догружаются: цепочки сезонов и фильмов длинные. Список дополнится сам, страницу обновлять не нужно.",
        ),
      );
    }
    if (!data.items.length) {
      parts.push(
        h(
          "div",
          { class: "empty" },
          data.incomplete
            ? "Пока ничего не нашли, ищем дальше."
            : "Для вашего списка пока нет анонсированных продолжений. Как только студии что-то объявят, это появится здесь.",
        ),
      );
    } else {
      for (const g of groupItems(data.items)) {
        parts.push(
          h(
            "section",
            { class: "day-group" },
            h("h2", { class: "day-title" }, g.title),
            h(
              "div",
              { class: "grid" },
              g.items.map((item) => titleCard(item, { showDate: true, showRelation: true, isNew: fresh.has(item.id) })),
            ),
          ),
        );
      }
    }
    clear(body).append(...parts);
  }

  ctx
    .loadRelated()
    .then((data) => {
      if (!isCurrent()) return;
      paint(data);
    })
    .catch((err) => {
      if (!isCurrent()) return;
      clear(body).append(
        h(
          "div",
          { class: "error-box", role: "alert" },
          h("p", null, err.message),
          h("button", { type: "button", class: "btn", onclick: () => renderUpcoming(root, ctx, isCurrent) }, "Повторить"),
        ),
      );
    });

  return {
    // Вызывается, когда обход связей продвинулся: перерисовываем список.
    refresh: () => {
      if (isCurrent() && ctx.relatedData) paint(ctx.relatedData);
    },
  };
}
