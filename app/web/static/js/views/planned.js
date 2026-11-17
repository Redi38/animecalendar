import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { mountPaged } from "../ui/paged.js";
import { createLoader } from "../loader.js";
import { fill, formatTitles, h, plural } from "../util.js";

const PAGE_SIZE = 60;

/** «Хочу посмотреть»: что пользователь отложил на потом. Новые сверху. Отметка «просмотрено» уводит тайтл в «Просмотрено». */
export function renderPlanned(root, ctx, isCurrent) {
  const { store } = ctx;
  const loader = createLoader(isCurrent);
  const list = h("div", null);
  let loaded = null; // { items, missing } по id, которые были в списке при загрузке
  let loadedIds = new Set();
  let stopPaging = null;

  fill(
    root,
    h("h1", { class: "page-title" }, "Хочу посмотреть"),
    h(
      "p",
      { class: "lead" },
      "Сюда попадают тайтлы, которые вы отметили закладкой. Когда нажмёте «Просмотрено», тайтл переедет в список просмотренного. Из этого списка можно крутить рулетку.",
    ),
    list,
  );

  function paint() {
    stopPaging?.();
    const ids = store.plannedIds();
    if (!ids.length) {
      fill(
        list,
        h(
          "div",
          { class: "empty empty-hero" },
          h("h2", null, "Список пуст"),
          h("p", null, "Нажмите на закладку на карточке тайтла, и он появится здесь."),
          h("a", { class: "btn btn-primary", href: "#/" }, "Перейти к сезонам"),
        ),
      );
      return;
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    const items = (loaded?.items || []).filter((i) => order.has(i.id)).sort((a, b) => order.get(b.id) - order.get(a.id));
    const known = new Set(items.map((i) => i.id));
    const missing = ids.filter((id) => !known.has(id));
    const parts = [h("p", { class: "result-count" }, formatTitles(ids.length))];
    if (missing.length) {
      parts.push(
        h(
          "div",
          { class: "notice" },
          `Не удалось загрузить данные для ${missing.length} ${plural(missing.length, ["тайтла", "тайтлов", "тайтлов"])}: каталог недоступен или они удалены.`,
        ),
      );
    }
    const grid = h("div", { class: "grid" });
    const more = h("div", { class: "load-more" });
    parts.push(grid, more);
    fill(list, ...parts);
    stopPaging = mountPaged(
      grid,
      more,
      items.map((item) => () => titleCard(item, { showDate: true })),
      { pageSize: PAGE_SIZE },
    );
  }

  async function load() {
    const ids = store.plannedIds();
    if (!ids.length) {
      loaded = null;
      loadedIds = new Set();
      return paint();
    }
    await loader.load(list, (signal) => api.titles(ids, signal), {
      loading: "Загружаем список…",
      onData: (data) => {
        loaded = data;
        loadedIds = new Set(ids);
        paint();
      },
    });
  }

  load();

  // Убрали тайтл или отметили просмотренным прямо здесь: карточка остаётся до обновления страницы (можно передумать).
  // Появился новый тайтл (например, из поиска) или список обновила синхронизация: перерисовываем.
  const unsubscribe = store.subscribe((source) => {
    const ids = store.plannedIds();
    if (!ids.length || source === "sync") return load();
    if (ids.some((id) => !loadedIds.has(id))) load();
  });

  return {
    cleanup: () => {
      loader.abort();
      stopPaging?.();
      unsubscribe();
    },
  };
}
