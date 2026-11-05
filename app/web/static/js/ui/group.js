import { describeGroup } from "../groups.js";
import { h } from "../util.js";
import { coverEl } from "./card.js";

/**
 * Раскрывающаяся группа-франшиза: шапка с обложкой и названием, внутри — тайтлы (сезоны, фильмы, OVA).
 * group — { title, cover, color }; items — карточки внутри; renderItem(item) возвращает элемент.
 * compact — список строк для выпадающих подсказок вместо сетки карточек.
 * onToggle(open) вызывается после раскрытия или сворачивания.
 */
export function groupSection({ group, items, renderItem, open = false, compact = false, onToggle }) {
  const body = h(
    "div",
    { class: "group-body", hidden: !open },
    h("div", { class: compact ? "group-list" : "grid" }, items.map(renderItem)),
  );
  const head = h(
    "button",
    {
      type: "button",
      class: "group-head",
      "aria-expanded": String(open),
      onclick: () => {
        const next = body.hidden; // сейчас свёрнута — значит, раскрываем
        body.hidden = !next;
        head.setAttribute("aria-expanded", String(next));
        section.classList.toggle("is-open", next);
        if (next) {
          section.classList.add("is-opening"); // анимация появления только в момент раскрытия
          setTimeout(() => section.classList.remove("is-opening"), 600);
        }
        onToggle?.(next);
      },
    },
    coverEl(group, compact ? "cover cover-xs" : "cover cover-sm"),
    h(
      "span",
      { class: "group-text" },
      h("span", { class: "group-title" }, group.title),
      h("span", { class: "group-meta" }, describeGroup(items)),
    ),
    h("span", { class: "dropdown-chevron group-chevron", "aria-hidden": "true" }),
  );
  const section = h("section", { class: `group${compact ? " group-compact" : ""}${open ? " is-open" : ""}` }, head, body);
  return section;
}
