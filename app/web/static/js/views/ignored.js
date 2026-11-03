import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { errorBox } from "../ui/error.js";
import { clear, formatTitles, h, plural } from "../util.js";

/** «Скрытые тайтлы»: то, что пользователь убрал из «Моих анонсов». Отсюда тайтл можно вернуть. */
export function renderIgnored(root, ctx, isCurrent) {
  const { store } = ctx;
  const controller = new AbortController();
  const list = h("div", null);
  let loaded = null; // { items, missing } — данные по скрытым id, чтобы возврат тайтла не перезапрашивал каталог

  clear(root).append(
    h("a", { class: "back-link", href: "#/upcoming" }, "← Мои анонсы"),
    h("h1", { class: "page-title" }, "Скрытые тайтлы"),
    h(
      "p",
      { class: "lead" },
      "Здесь тайтлы, которые вы не планируете смотреть: в «Моих анонсах» их нет. Откройте карточку тайтла, нажмите «⋯» слева от крестика и выберите «Вернуть в анонсы».",
    ),
    list,
  );

  function paint() {
    const ids = new Set(store.ignoredIds());
    if (!ids.size) {
      clear(list).append(
        h(
          "div",
          { class: "empty empty-hero" },
          h("h2", null, "Скрытых тайтлов нет"),
          h("p", null, "Откройте карточку тайтла в «Моих анонсах», нажмите «⋯» слева от крестика и выберите «Игнорировать»."),
          h("a", { class: "btn btn-primary", href: "#/upcoming" }, "К моим анонсам"),
        ),
      );
      return;
    }
    const items = (loaded?.items || []).filter((i) => ids.has(i.id));
    const known = new Set(items.map((i) => i.id));
    const missing = [...ids].filter((id) => !known.has(id));
    const parts = [h("p", { class: "result-count" }, formatTitles(ids.size))];
    if (missing.length) {
      parts.push(
        h(
          "div",
          { class: "notice" },
          `Не удалось загрузить данные для ${missing.length} ${plural(missing.length, ["тайтла", "тайтлов", "тайтлов"])}: каталог недоступен или они удалены. Они остаются скрытыми.`,
        ),
      );
    }
    parts.push(
      h(
        "div",
        { class: "grid" },
        items.map((item) => titleCard(item, { showDate: true })),
      ),
    );
    clear(list).append(...parts);
  }

  async function load() {
    const ids = store.ignoredIds();
    if (!ids.length) return paint();
    clear(list).append(h("div", { class: "loading", role: "status" }, "Загружаем скрытые тайтлы…"));
    try {
      const data = await api.titles(ids, controller.signal);
      if (!isCurrent()) return;
      loaded = data;
      paint();
    } catch (err) {
      if (err.name === "AbortError" || !isCurrent()) return;
      clear(list).append(errorBox(err.message, { onRetry: load }));
    }
  }

  load();

  return {
    cleanup: () => controller.abort(),
    // Вернули тайтл из карточки: перерисовываем без запроса.
    refresh: () => {
      if (isCurrent() && loaded) paint();
    },
  };
}
