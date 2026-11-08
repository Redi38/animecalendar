import { h } from "../util.js";

/**
 * Одна кнопка «Список» вместо трёх: меню собирается при открытии, поэтому пункты зависят от того,
 * пуст ли список сейчас. items() -> [{ label, run, danger? }].
 */
export function listMenu(items) {
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
