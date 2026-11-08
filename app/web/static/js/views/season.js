import { api } from "../api.js";
import { titleCard } from "../ui/card.js";
import { orderDays } from "../daygroups.js";
import { errorBox } from "../ui/error.js";
import { selectField } from "../ui/select.js";
import { replayEnter } from "../ui/motion.js";
import { seasonIndex, seasonStep } from "../seasons.js";
import { readJson, writeJson } from "../storage.js";
import { capitalize, debounce, fill, formatStart, formatTitles, h, normalize, todayIso } from "../util.js";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // "2026-fall" -> { at, data }

const FORMAT_GROUPS = [
  { id: "all", label: "Все", test: () => true },
  { id: "tv", label: "ТВ", test: (i) => i.format === "TV" || i.format === "TV_SHORT" },
  { id: "movie", label: "Фильмы", test: (i) => i.format === "MOVIE" },
  { id: "other", label: "ONA / OVA / спешлы", test: (i) => ["ONA", "OVA", "SPECIAL", "MUSIC"].includes(i.format) },
];

const PREF_KEY = "anime_calendar_prefs_v1";
function loadPrefs() {
  const saved = readJson(PREF_KEY, {});
  return { group: "day", format: "all", ...(saved && typeof saved === "object" ? saved : {}) };
}
function savePrefs(prefs) {
  writeJson(PREF_KEY, prefs);
}

export async function loadSeason(year, slug, { force = false, signal } = {}) {
  const key = `${year}-${slug}`;
  const hit = cache.get(key);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await api.season(year, slug, signal);
  cache.set(key, { at: Date.now(), data });
  return data;
}

function seasonNav(meta, year, slug) {
  const { current, min_year: minYear, max_year: maxYear } = meta;
  const years = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);
  const select = selectField(
    h(
      "select",
      { class: "year-select", "aria-label": "Год", onchange: (e) => (location.hash = `#/season/${e.target.value}/${slug}`) },
      years.map((y) => h("option", { value: y, selected: y === year }, String(y))),
    ),
  );
  const slugs = meta.seasons.map((s) => s.slug);
  const step = (delta) => {
    const target = seasonStep(slugs, year, slug, delta);
    return `#/season/${target.year}/${target.slug}`;
  };
  const index = seasonIndex(slugs, year, slug);
  const canPrev = index - 1 >= minYear * slugs.length;
  const canNext = index + 1 <= maxYear * slugs.length + slugs.length - 1;
  const arrow = (dir, ok, label) =>
    ok
      ? h("a", { class: "icon-btn", href: step(dir), "aria-label": label }, dir < 0 ? "‹" : "›")
      : h("span", { class: "icon-btn is-disabled", "aria-hidden": "true" }, dir < 0 ? "‹" : "›");

  const tabs = meta.seasons.map((s) =>
    h(
      "a",
      {
        class: "season-tab",
        href: `#/season/${year}/${s.slug}`,
        "aria-current": s.slug === slug ? "page" : null,
        "data-now": current.year === year && current.season === s.code ? "1" : null,
      },
      s.label,
      current.year === year && current.season === s.code ? h("span", { class: "now-dot", title: "Идёт сейчас" }) : null,
    ),
  );

  return h(
    "div",
    { class: "season-nav" },
    h("div", { class: "year-nav" }, arrow(-1, canPrev, "Предыдущий сезон"), select, arrow(1, canNext, "Следующий сезон")),
    h("div", { class: "season-tabs", role: "navigation", "aria-label": "Сезоны года и анонсы без даты" }, [...tabs, tbaTab(false)]),
    h("a", { class: "btn btn-ghost", href: `#/season/${current.year}/${current.season.toLowerCase()}` }, "К текущему сезону"),
  );
}

/** Вкладка «Без даты» рядом с сезонами: анонсы, у которых ещё нет ни сезона, ни даты. */
export function tbaTab(active) {
  return h("a", { class: "season-tab", href: "#/tba", "aria-current": active ? "page" : null }, "Без даты");
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
  const content = h("div", { class: "season-content" }, h("div", { class: "loading", role: "status" }, "Загружаем сезон…"));
  fill(
    root,
    h("h1", { class: "page-title" }, `${meta.seasons.find((s) => s.slug === slug).label} ${year}`),
    nav,
    toolbar,
    content,
  );

  let data = null;

  function visibleItems() {
    const fmt = FORMAT_GROUPS.find((g) => g.id === prefs.format) || FORMAT_GROUPS[0];
    const words = normalize(state.text).split(" ").filter(Boolean);
    return data.items.filter((item) => {
      if (!fmt.test(item)) return false;
      if (state.onlyRelated && !ctx.relatedIds.has(item.id)) return false;
      if (!words.length) return true;
      const hay = normalize(`${item.title} ${item.subtitle || ""} ${item.title_native || ""}`);
      return words.every((w) => hay.includes(w));
    });
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
        chipButton(g.label, prefs.format === g.id, (e) => {
          prefs.format = g.id;
          savePrefs(prefs);
          pressOnly(e.currentTarget);
          paintList(true);
        }),
      ),
    );
    const grouping = h(
      "div",
      { class: "chip-row", role: "group", "aria-label": "Порядок" },
      chipButton("По дням", prefs.group === "day", (e) => {
        prefs.group = "day";
        savePrefs(prefs);
        pressOnly(e.currentTarget);
        paintList(true);
      }),
      chipButton("По популярности", prefs.group === "popular", (e) => {
        prefs.group = "popular";
        savePrefs(prefs);
        pressOnly(e.currentTarget);
        paintList(true);
      }),
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

  function group(items) {
    if (prefs.group === "popular") return [{ key: "popular", title: null, items }];
    const byDay = new Map();
    const undated = [];
    for (const item of items) {
      if (item.start_precision === "day") {
        if (!byDay.has(item.start)) byDay.set(item.start, []);
        byDay.get(item.start).push(item);
      } else {
        undated.push(item);
      }
    }
    const groups = orderDays([...byDay.keys()], todayIso())
      .map((day) => ({ key: day, day, title: capitalize(formatStart(day, "day", "group")), items: byDay.get(day) }));
    if (undated.length) groups.push({ key: "undated", title: "Дата выхода уточняется", items: undated });
    return groups;
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
    const sections = group(items).map((g) =>
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
  const controller = new AbortController();
  loadSeason(year, slug, { signal: controller.signal })
    .then((loaded) => {
      if (!isCurrent()) return;
      data = loaded;
      paintList();
    })
    .catch((err) => {
      if (err.name === "AbortError" || !isCurrent()) return;
      fill(content, errorBox(err.message, { onRetry: () => renderSeason(root, { year, slug }, ctx, isCurrent) }));
    });

  return {
    cleanup: () => controller.abort(),
    // Вызывается, когда подтянулись связанные тайтлы: обновляем отметки и фильтр.
    refresh: () => {
      if (!data) return;
      paintToolbar();
      paintList();
    },
  };
}

