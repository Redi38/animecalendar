import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { createLoader } from "../loader.js";
import { replayEnter } from "../ui/motion.js";
import { seasonNav } from "../ui/seasonnav.js";
import { FORMAT_GROUPS, filterItems, groupItems, loadPrefs, savePrefs } from "../seasonfilters.js";
import { debounce, fill, formatTitles, h, todayIso } from "../util.js";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // "2026-fall" -> { at, data }

export async function loadSeason(year, slug, { force = false, signal } = {}) {
  const key = `${year}-${slug}`;
  const hit = cache.get(key);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await api.season(year, slug, signal);
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** Выбранной остаётся одна кнопка группы; остальные гаснут плавно, без пересборки панели. */
function pressOnly(btn) {
  for (const b of btn.parentElement.querySelectorAll(".filter-chip")) {
    b.setAttribute("aria-pressed", b === btn ? "true" : "false");
  }
}

function chipButton(label, active, onclick) {
  return h("button", { type: "button", class: "filter-chip", "aria-pressed": active ? "true" : "false", onclick }, label);
}

export function renderSeason(root, { year, slug }, ctx, isCurrent) {
  const { meta } = ctx;
  const prefs = loadPrefs();
  const state = { text: "", onlyRelated: false };

  const nav = seasonNav(meta, year, slug);
  const toolbar = h("div", { class: "toolbar" });
  const content = h("div", { class: "season-content" });
  fill(
    root,
    h("h1", { class: "page-title" }, `${meta.seasons.find((s) => s.slug === slug).label} ${year}`),
    nav,
    toolbar,
    content,
  );

  let data = null;

  function visibleItems() {
    return filterItems(data.items, { format: prefs.format, text: state.text, onlyRelated: state.onlyRelated, relatedIds: ctx.relatedIds });
  }

  /** Выбор в группе кнопок: запоминаем, подсвечиваем выбранную и перерисовываем список. */
  function setPref(key, value, btn) {
    prefs[key] = value;
    savePrefs(prefs);
    pressOnly(btn);
    paintList(true);
  }

  function paintToolbar() {
    const filter = h("input", {
      type: "search",
      class: "inline-filter",
      placeholder: "Фильтр по названию в этом сезоне",
      "aria-label": "Фильтр по названию в этом сезоне",
      value: state.text,
      oninput: debounce((e) => {
        state.text = e.target.value;
        paintList();
      }, 150),
    });
    const formats = h(
      "div",
      { class: "chip-row", role: "group", "aria-label": "Формат" },
      FORMAT_GROUPS.map((g) =>
        chipButton(g.label, prefs.format === g.id, (e) => setPref("format", g.id, e.currentTarget)),
      ),
    );
    const grouping = h(
      "div",
      { class: "chip-row", role: "group", "aria-label": "Порядок" },
      chipButton("По дням", prefs.group === "day", (e) => setPref("group", "day", e.currentTarget)),
      chipButton("По популярности", prefs.group === "popular", (e) => setPref("group", "popular", e.currentTarget)),
    );
    const related = ctx.relatedIds.size
      ? chipButton("★ Связано с моим списком", state.onlyRelated, (e) => {
          state.onlyRelated = !state.onlyRelated;
          e.currentTarget.setAttribute("aria-pressed", String(state.onlyRelated));
          paintList(true);
        })
      : null;
    const keepFocus = document.activeElement?.classList?.contains("inline-filter");
    fill(toolbar, filter, formats, h("div", { class: "chip-row" }, grouping, related));
    if (keepFocus) {
      const el = toolbar.querySelector(".inline-filter");
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }

  function paintList(animate = false) {
    const items = visibleItems();
    const total = data.items.length;
    const count = h(
      "p",
      { class: "result-count", role: "status" },
      items.length === total
        ? formatTitles(total)
        : `Показано ${items.length} из ${total}`,
    );
    if (!items.length) {
      fill(
        content,
        count,
        h(
          "div",
          { class: "empty" },
          total
            ? "Под эти фильтры ничего не подошло. Попробуйте сбросить фильтры."
            : "На этот сезон в каталоге пока нет тайтлов. Анонсы появляются по мере того, как студии их объявляют.",
        ),
      );
      if (animate) replayEnter(content);
      return;
    }
    const today = todayIso();
    const sections = groupItems(items, prefs.group, today).map((g) =>
      h(
        "section",
        { class: `day-group${g.day === today ? " is-today" : ""}${g.day && g.day < today ? " is-past" : ""}`, "data-day": g.day || null },
        g.title
          ? h("h2", { class: "day-title" }, g.title, g.day === today ? h("span", { class: "chip chip-today" }, "сегодня") : null)
          : null,
        h(
          "div",
          { class: "grid" },
          g.items.map((item) =>
            titleCard(item, { showDate: prefs.group !== "day", related: ctx.relatedIds.has(item.id) }),
          ),
        ),
      ),
    );
    fill(content, count, ...sections);
    if (animate) replayEnter(content);
  }

  paintToolbar();
  const loader = createLoader(isCurrent);
  loader.load(content, (signal) => loadSeason(year, slug, { signal }), {
    loading: "Загружаем сезон…",
    onData: (loaded) => {
      data = loaded;
      paintList();
    },
  });

  return {
    cleanup: loader.abort,
    // Вызывается, когда подтянулись связанные тайтлы: обновляем отметки и фильтр.
    refresh: () => {
      if (!data) return;
      paintToolbar();
      paintList();
    },
  };
}

