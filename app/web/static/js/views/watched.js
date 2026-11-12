import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { groupSection } from "../ui/group.js";
import { arrangeByFranchise } from "../groups.js";
import { toast } from "../ui/toast.js";
import { createLoader, loadingBox } from "../loader.js";
import { errorBox } from "../ui/error.js";
import { replayEnter } from "../ui/motion.js";
import { loadSort, saveSort, sortItems } from "../watchedsort.js";
import { createListFile } from "./watched-import.js";
import { watchedActions } from "./watched-actions.js";
import { fill, formatTitles, h, plural } from "../util.js";

export function renderWatched(root, ctx, isCurrent) {
  const { store } = ctx;
  const list = h("div", null);
  const status = h("p", { class: "lead", role: "status" });
  const report = h("div", null);
  const loader = createLoader(isCurrent);
  let sort = loadSort();
  let lastLoad = null; // { data, ids } — чтобы менять сортировку без повторного запроса
  let groupsCache = null; // { key, groups } — франшизы для текущего списка, запрашиваются при первой сортировке «По тайтлам»
  const openGroups = new Set(); // раскрытые группы переживают перерисовку списка

  /** Карточка списка; для импортированных тайтлов показываем название из файла, чтобы заметить неверное совпадение. */
  function watchedCard(item) {
    const card = titleCard(item, { showDate: true });
    const source = store.importedAs(item.id);
    if (source && source !== item.title) {
      card.querySelector(".tcard-body").append(h("p", { class: "tcard-imported", title: "Название в вашем файле" }, `Из файла: «${source}»`));
    }
    return card;
  }

  const listFile = createListFile({ store, status, report, signal: loader.signal });
  const actions = watchedActions({
    store,
    sort,
    listFile,
    onSort: (id) => {
      sort = id;
      saveSort(sort);
      if (lastLoad) show().then((shown) => shown && replayEnter(list));
    },
  });

  fill(
    root,
    h("h1", { class: "page-title" }, "Просмотрено"),
    h(
      "p",
      { class: "lead" },
      "Список хранится в этом браузере. Чтобы перенести его на другое устройство, скачайте файл и загрузите его там.",
    ),
    actions,
    status,
    report,
    list,
  );

  let shownIds = null;

  /** Группа-франшиза в списке: раскрывается по клику, внутри — просмотренные тайтлы этой франшизы. */
  function franchiseGroup(entry) {
    return groupSection({
      group: entry,
      items: entry.items,
      renderItem: watchedCard,
      open: openGroups.has(entry.id),
      onToggle: (open) => (open ? openGroups.add(entry.id) : openGroups.delete(entry.id)),
    });
  }

  /**
   * Рисует список в выбранной сортировке. Для «По тайтлам» сначала запрашиваем группы у сервера.
   * keep — перерисовка уже показанного списка (добавили тайтл): старый список остаётся на экране, пока грузятся
   * группы, иначе страница схлопывается до заглушки и прокрутка улетает вверх.
   * Возвращает true, если список нарисован (а не отменён сменой сортировки или страницы).
   */
  async function show(keep = false) {
    const load = lastLoad;
    if (sort === "franchise") {
      const key = load.ids.join(",");
      if (groupsCache?.key !== key) {
        if (!keep || !list.querySelector(".grid")) {
          fill(list, loadingBox("Собираем франшизы…"));
        }
        try {
          const res = await api.groups(load.ids, loader.signal);
          groupsCache = { key, groups: res.groups };
        } catch (err) {
          if (err.name === "AbortError" || !isCurrent()) return false;
          // Группы не собрались: показываем список по алфавиту, а при следующем выборе сортировки попробуем снова.
          toast("Не удалось собрать франшизы. Показан список по алфавиту.", "error");
        }
        if (!isCurrent() || lastLoad !== load || sort !== "franchise") return false;
      }
    }
    renderList();
    return true;
  }

  function renderList() {
    const { data, ids } = lastLoad;
    const franchise = sort === "franchise" && groupsCache?.key === ids.join(",");
    const parts = [
      h("p", { class: "result-count" }, formatTitles(ids.length)),
    ];
    if (data.missing.length) {
      parts.push(
        h(
          "div",
          { class: "notice" },
          `Не удалось загрузить данные для ${data.missing.length} ${plural(data.missing.length, ["тайтла", "тайтлов", "тайтлов"])}: каталог недоступен или они удалены. Они остаются в списке.`,
        ),
      );
    }
    if (franchise) {
      const entries = arrangeByFranchise(data.items, groupsCache.groups);
      parts.push(
        h(
          "div",
          { class: "grid" },
          entries.map((e) => (e.kind === "group" ? franchiseGroup(e) : watchedCard(e.item))),
        ),
      );
    } else {
      parts.push(h("div", { class: "grid" }, sortItems(data.items, ids, sort).map(watchedCard)));
    }
    fill(list, ...parts);
  }

  async function paint() {
    const ids = store.ids();
    if (!ids.length) {
      lastLoad = null;
      fill(
        list,
        h(
          "div",
          { class: "empty empty-hero" },
          h("h2", null, "Пока ничего не отмечено"),
          h("p", null, "Нажмите на значок с глазом на карточке тайтла или найдите сериал через поиск вверху страницы."),
          h("a", { class: "btn btn-primary", href: "#/" }, "Перейти к сезонам"),
        ),
      );
      return;
    }
    // Добавили тайтл, пока список уже на экране: оставляем его до прихода новых данных. Заглушка вместо списка
    // схлопывает страницу, и браузер сбрасывает прокрутку вверх.
    const keep = lastLoad !== null;
    if (!keep) fill(list, loadingBox("Загружаем ваш список…"));
    await loader.run(
      (signal) => api.titles(ids, signal),
      async (data) => {
        shownIds = new Set(ids);
        lastLoad = { data, ids };
        await show(keep);
      },
      (err) => {
        lastLoad = null;
        fill(list, errorBox(err.message, { onRetry: paint }));
      },
    );
  }

  paint();

  // Убрали тайтл прямо на этой странице — карточка остаётся (с кнопкой «вернуть»), пока не обновим страницу.
  // Добавили или загрузили файл — перерисовываем.
  const unsubscribe = store.subscribe((source) => {
    const ids = new Set(store.ids());
    const added = [...ids].some((id) => !shownIds || !shownIds.has(id));
    // Синхронизация могла и убрать тайтлы: после неё список пересобираем целиком.
    if (added || ids.size === 0 || source === "sync") paint();
  });

  return {
    cleanup: () => {
      loader.abort();
      unsubscribe();
    },
  };
}
