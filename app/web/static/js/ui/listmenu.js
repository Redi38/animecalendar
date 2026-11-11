import { actionMenu } from "./actionmenu.js";
import { h } from "../util.js";

/**
 * Одна кнопка «Управление списком» вместо трёх: меню собирается при открытии, поэтому пункты зависят от того,
 * пуст ли список сейчас. items() -> [{ label, run, danger? }].
 */
export function listMenu(items) {
  return actionMenu({
    rootClass: "list-menu",
    listClass: "list-menu-list",
    trigger: {
      props: { class: "btn" },
      content: ["Управление списком", h("span", { class: "dropdown-chevron", "aria-hidden": "true" })],
    },
    actions: items,
  });
}
