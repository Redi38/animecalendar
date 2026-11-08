import { h } from "../util.js";

/**
 * Меню «⋯» слева от крестика. actions: [{ label, run }] — пункты меню
 * («Переименовать» в списке просмотренного, «Игнорировать» в «Моих анонсах», «Вернуть» в скрытых).
 */
export function titleMenu(d, actions) {
  const setOpen = (open) => {
    list.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) items[0].focus();
  };
  const items = actions.map((a) =>
    h(
      "button",
      {
        type: "button",
        class: "dialog-menu-item",
        role: "menuitem",
        onclick: () => {
          setOpen(false);
          a.run(d);
        },
      },
      a.label,
    ),
  );
  const list = h("div", { class: "dialog-menu-list", role: "menu", hidden: true }, items);
  const btn = h(
    "button",
    {
      type: "button",
      class: "dialog-menu-btn",
      "aria-label": "Меню тайтла",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      onclick: () => setOpen(list.hidden),
    },
    "⋯",
  );
  const root = h("div", { class: "dialog-menu" }, btn, list);
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || list.hidden) return;
    event.preventDefault();
    event.stopPropagation(); // Esc закрывает меню, а не всю карточку
    setOpen(false);
    btn.focus();
  });
  return root;
}

export function closeMenus(dialog) {
  for (const list of dialog.querySelectorAll(".dialog-menu-list")) list.hidden = true;
  for (const btn of dialog.querySelectorAll(".dialog-menu-btn")) btn.setAttribute("aria-expanded", "false");
}
