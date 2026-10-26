import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { toast } from "../ui/toast.js";
import { clear, h, plural } from "../util.js";

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderWatched(root, ctx, isCurrent) {
  const { store } = ctx;
  const list = h("div", null);
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
    h(
      "button",
      {
        type: "button",
        class: "btn",
        onclick: () => {
          if (!store.size()) return toast("Список пока пуст");
          download("anime-watched.json", JSON.stringify({ watched: store.ids() }));
        },
      },
      "Скачать список",
    ),
    h("button", { type: "button", class: "btn", onclick: () => fileInput.click() }, "Загрузить список"),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-danger",
        onclick: () => {
          if (store.size() && confirm("Очистить весь список просмотренного?")) store.clear();
        },
      },
      "Очистить",
    ),
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
    list,
  );

  let shownIds = null;
  const controller = new AbortController();

  async function paint() {
    const ids = store.ids();
    if (!ids.length) {
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
    clear(list).append(h("div", { class: "loading", role: "status" }, "Загружаем ваш список…"));
    try {
      const data = await api.titles(ids, controller.signal);
      if (!isCurrent()) return;
      shownIds = new Set(ids);
      const items = data.items.sort((a, b) => a.title.localeCompare(b.title, "ru"));
      const parts = [
        h("p", { class: "result-count" }, `${ids.length} ${plural(ids.length, ["тайтл", "тайтла", "тайтлов"])}`),
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
      parts.push(h("div", { class: "grid" }, items.map((item) => titleCard(item, { showDate: true }))));
      clear(list).append(...parts);
    } catch (err) {
      if (err.name === "AbortError" || !isCurrent()) return;
      clear(list).append(
        h("div", { class: "error-box", role: "alert" }, h("p", null, err.message), h("button", { type: "button", class: "btn", onclick: paint }, "Повторить")),
      );
    }
  }

  paint();

  // Убрали тайтл прямо на этой странице — карточка остаётся (с кнопкой «вернуть»), пока не обновим страницу.
  // Добавили или загрузили файл — перерисовываем.
  const unsubscribe = store.subscribe(() => {
    const ids = new Set(store.ids());
    const added = [...ids].some((id) => !shownIds || !shownIds.has(id));
    if (added || ids.size === 0) paint();
  });

  return {
    cleanup: () => {
      controller.abort();
      unsubscribe();
    },
  };
}
