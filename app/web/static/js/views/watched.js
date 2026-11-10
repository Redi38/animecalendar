import { api } from "../api.js";
import { parseListFile, resolveTitles } from "../importer.js";
import { titleCard } from "../ui/card.js";
import { groupSection } from "../ui/group.js";
import { arrangeByFranchise } from "../groups.js";
import { toast } from "../ui/toast.js";
import { confirmDialog } from "../ui/confirm.js";
import { createLoader, loadingBox } from "../loader.js";
import { errorBox } from "../ui/error.js";
import { dropdown } from "../ui/dropdown.js";
import { listMenu } from "../ui/listmenu.js";
import { replayEnter } from "../ui/motion.js";
import { storageGet, storageSet } from "../storage.js";
import { clear, download, fill, formatTitles, h, plural } from "../util.js";

const SORT_KEY = "anime_calendar_watched_sort_v1";
const SORTS = [
  { id: "alpha", label: "По алфавиту" },
  { id: "added", label: "По порядку добавления" },
  { id: "franchise", label: "По тайтлам" },
];

function loadSort() {
  const v = storageGet(SORT_KEY);
  return SORTS.some((x) => x.id === v) ? v : "alpha";
}

function saveSort(v) {
  storageSet(SORT_KEY, v);
}

export function renderWatched(root, ctx, isCurrent) {
  const { store } = ctx;
  const list = h("div", null);
  const status = h("p", { class: "lead", role: "status" });
  const report = h("div", null);
  const loader = createLoader(isCurrent);
  let importing = false;
  let sort = loadSort();
  let lastLoad = null; // { data, ids } — чтобы менять сортировку без повторного запроса
  let groupsCache = null; // { key, groups } — франшизы для текущего списка, запрашиваются при первой сортировке «По тайтлам»
  const openGroups = new Set(); // раскрытые группы переживают перерисовку списка

  function showReport(summary, failed) {
    const parts = [h("p", null, summary)];
    if (failed.length) {
      parts.push(
        h("p", null, "Эти тайтлы не добавлены:"),
        h("ul", null, failed.map((f) => h("li", null, `${f.title}: ${f.reason}`))),
      );
    }
    parts.push(h("button", { type: "button", class: "btn", onclick: () => clear(report) }, "Закрыть"));
    fill(report, h("div", { class: "notice", role: "alert" }, parts));
  }

  /** Карточка списка; для импортированных тайтлов показываем название из файла, чтобы заметить неверное совпадение. */
  function watchedCard(item) {
    const card = titleCard(item, { showDate: true });
    const source = store.importedAs(item.id);
    if (source && source !== item.title) {
      card.querySelector(".tcard-body").append(h("p", { class: "tcard-imported", title: "Название в вашем файле" }, `Из файла: «${source}»`));
    }
    return card;
  }

  async function importTitles({ titles, skipped }) {
    if (importing) return;
    importing = true;
    clear(report);
    try {
      const { found, failed } = await resolveTitles(
        titles,
        (done, total) => {
          status.textContent = done < total ? `Ищем тайтлы: ${done} из ${total}…` : "";
        },
        controller.signal,
      );
      store.addImported(found);
      const inList = new Set(store.ids());
      for (const f of found) {
        if (!inList.has(f.id)) failed.push({ title: f.title, reason: "список переполнен, максимум 500 тайтлов" });
      }
      const ok = titles.length - failed.length;
      const extra = skipped ? ` Записей без названия в файле: ${skipped}.` : "";
      showReport(`Обработано названий: ${titles.length}. В списке: ${ok}, не добавлено: ${failed.length}.${extra}`, failed);
    } catch (err) {
      if (err.name !== "AbortError") toast("Не удалось найти тайтлы. Попробуйте позже.", "error");
    } finally {
      importing = false;
      status.textContent = "";
    }
  }
  const fileInput = h("input", {
    type: "file",
    accept: "application/json,.json",
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const parsed = parseListFile(JSON.parse(await file.text()));
        if (parsed.kind === "titles") {
          toast(`Ищем ${parsed.titles.length} тайтлов по названиям, это займёт пару минут`);
          importTitles(parsed);
          return;
        }
        const added = store.addMany(parsed.ids);
        toast(added ? `Добавлено тайтлов: ${added}` : "Новых тайтлов в файле нет");
      } catch {
        toast("Не удалось прочитать файл. Нужен JSON, который вы скачали здесь же.", "error");
      }
    },
  });

  const actions = h(
    "div",
    { class: "toolbar-actions" },
    dropdown({
      label: "Сортировка",
      triggerText: "Сортировка",
      options: SORTS,
      value: sort,
      onChange: (id) => {
        sort = id;
        saveSort(sort);
        if (lastLoad) show().then((shown) => shown && replayEnter(list));
      },
    }),
    listMenu(() => {
      const items = [{ label: "Загрузить список", run: () => fileInput.click() }];
      // Пока список пуст, скачивать и очищать нечего: остаётся только загрузка.
      if (store.size()) {
        items.unshift({
          label: "Скачать список",
          run: () => download("anime-watched.json", JSON.stringify({ watched: store.ids() })),
        });
        items.push({
          label: "Очистить",
          danger: true,
          run: async () => {
            const n = store.size();
            if (!n) return;
            const ok = await confirmDialog({
              title: "Очистить список просмотренного?",
              text: `Будет удалено ${formatTitles(n)}. Отменить это нельзя, поэтому сначала можно скачать список файлом.`,
              confirmLabel: "Очистить список",
              danger: true,
            });
            if (!ok) return;
            store.clear();
            toast("Список очищен");
          },
        });
      }
      return items;
    }),
    fileInput,
  );

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
    const order = new Map(ids.map((id, i) => [id, i])); // Set хранит порядок добавления
    const franchise = sort === "franchise" && groupsCache?.key === ids.join(",");
    const items = [...data.items].sort(
      sort === "added"
        ? (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
        : (a, b) => a.title.localeCompare(b.title, "ru"),
    );
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
      parts.push(h("div", { class: "grid" }, items.map(watchedCard)));
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
