import { actionMenu } from "./actionmenu.js";

/**
 * Меню «⋯» слева от крестика. actions: [{ label, run }] — пункты меню
 * («Переименовать» в списке просмотренного, «Игнорировать» в «Моих анонсах», «Вернуть» в скрытых).
 * run получает данные тайтла.
 */
export function titleMenu(d, actions) {
  return actionMenu({
    rootClass: "dialog-menu",
    listClass: "dialog-menu-list",
    trigger: { props: { class: "dialog-menu-btn", "aria-label": "Меню тайтла" }, content: "⋯" },
    actions: () => actions.map((a) => ({ label: a.label, run: () => a.run(d) })),
    stopEscape: true,
  });
}
