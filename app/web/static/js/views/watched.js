import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { groupSection } from "../ui/group.js";
import { arrangeByFranchise } from "../groups.js";
import { toast } from "../ui/toast.js";
import { confirmDialog } from "../ui/confirm.js";
import { errorBox } from "../ui/error.js";
import { dropdown } from "../ui/dropdown.js";
import { replayEnter } from "../ui/motion.js";
import { storageGet, storageSet } from "../storage.js";
import { clear, formatTitles, h, plural } from "../util.js";

const SEARCH_PAUSE_MS = 1100; // сервер пускает не больше 60 поисков в минуту с одного IP
const RATE_LIMIT_WAIT_MS = 61000;

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** Названия из файла: массив строк или объектов {title}. Записи без названия пропускаются. Иначе null. */
function titlesFromFile(data) {
  if (!Array.isArray(data) || !data.length) return null;
  const all = data.map((x) => (typeof x === "string" ? x : x && typeof x.title === "string" ? x.title : null));
  const titles = all.filter((t) => t && t.trim()).map((t) => t.trim());
  if (!titles.length) return null;
  return { titles, skipped: all.length - titles.length };
}

/** Ищет каждое название через поиск сайта и берёт первый результат. */
async function resolveTitles(titles, onProgress, signal) {
  const found = []; // { title, id }
  const failed = []; // { title, reason }
  for (let i = 0; i < titles.length; i++) {
    onProgress(i, titles.length);
    let items = null;
    let reason = "не найдено в каталоге";
    for (let attempt = 0; attempt < 2 && items === null; attempt++) {
      try {
        items = (await api.search(titles[i], true, signal)).items;
      } catch (err) {
        if (err.name === "AbortError") throw err;
        reason = err.status === 429 ? "слишком много запросов" : "ошибка поиска";
        if (err.status === 429 && attempt === 0) await sleep(RATE_LIMIT_WAIT_MS, signal);
        else break;
      }
    }
    if (items && items.length) found.push({ title: titles[i], id: items[0].id });
    else failed.push({ title: titles[i], reason });
    await sleep(SEARCH_PAUSE_MS, signal);
  }
  onProgress(titles.length, titles.length);
  return { found, failed };
}

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

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Одна кнопка «Список» вместо трёх: меню собирается при открытии, поэтому пункты зависят от того,
 * пуст ли список сейчас. items() -> [{ label, run, danger? }].
 */
function listMenu(items) {
  const setOpen = (open) => {
    if (open) {
      menu.replaceChildren(
        ...items().map((a) =>
          h(
            "button",
            {
              type: "button",
              class: `dialog-menu-item${a.danger ? " is-danger" : ""}`,
              role: "menuitem",
              onclick: () => {
                setOpen(false);
                a.run();
              },
            },
            a.label,
          ),
        ),
      );
      document.addEventListener("pointerdown", onOutside, true);
    } else {
      document.removeEventListener("pointerdown", onOutside, true);
    }
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) menu.firstElementChild?.focus();
  };
  const onOutside = (event) => {
    if (!root.contains(event.target)) setOpen(false);
  };
  const menu = h("div", { class: "list-menu-list", role: "menu", hidden: true });
  const btn = h(
    "button",
    { type: "button", class: "btn", "aria-haspopup": "menu", "aria-expanded": "false", onclick: () => setOpen(menu.hidden) },
    "Управление списком",
    h("span", { class: "dropdown-chevron", "aria-hidden": "true" }),
  );
  const root = h("div", { class: "list-menu" }, btn, menu);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      setOpen(false);
      btn.focus();
    }
  });
  return root;
}

export function renderWatched(root, ctx, isCurrent) {
  const { store } = ctx;
  const list = h("div", null);
  const status = h("p", { class: "lead", role: "status" });
  const report = h("div", null);
  const controller = new AbortController();
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
    clear(report).append(h("div", { class: "notice", role: "alert" }, parts));
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
        const data = JSON.parse(await file.text());
        const parsed = titlesFromFile(data);
        if (parsed) {
          toast(`Ищем ${parsed.titles.length} тайтлов по названиям, это займёт пару минут`);
          importTitles(parsed);
          return;
        }
        const ids = Array.isArray(data) ? data : data.watched;
        if (!Array.isArray(ids)) throw new Error("bad format");
        const added = store.addMany(ids);
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

  clear(root).append(
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
          clear(list).append(h("div", { class: "loading", role: "status" }, "Собираем франшизы…"));
        }
        try {
          const res = await api.groups(load.ids, controller.signal);
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
    clear(list).append(...parts);
  }

  async function paint() {
    const ids = store.ids();
    if (!ids.length) {
      lastLoad = null;
      clear(list).append(
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
    if (!keep) clear(list).append(h("div", { class: "loading", role: "status" }, "Загружаем ваш список…"));
    try {
      const data = await api.titles(ids, controller.signal);
      if (!isCurrent()) return;
      shownIds = new Set(ids);
      lastLoad = { data, ids };
      await show(keep);
    } catch (err) {
      if (err.name === "AbortError" || !isCurrent()) return;
      lastLoad = null;
      clear(list).append(errorBox(err.message, { onRetry: paint }));
    }
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
      controller.abort();
      unsubscribe();
    },
  };
}
