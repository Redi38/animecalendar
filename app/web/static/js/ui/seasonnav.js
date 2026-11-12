import { selectField } from "./select.js";
import { seasonIndex, seasonStep } from "../seasons.js";
import { h } from "../util.js";

/** Навигация по сезонам: год, стрелки, вкладки сезонов и «Без даты». meta — ответ /api/meta. */
export function seasonNav(meta, year, slug) {
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
