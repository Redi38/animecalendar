import { h } from "../util.js";

/**
 * Кнопка с выпадающим меню действий — общая основа для «Управления списком» и меню «⋯» в карточке.
 * Пункты собираются при каждом открытии, поэтому зависят от текущего состояния.
 *
 * rootClass / listClass — классы обёртки и списка (оформление у меню разное);
 * trigger — { props, content } кнопки; actions() -> [{ label, run, danger? }];
 * stopEscape — не пускать Esc дальше, чтобы он закрывал меню, а не всю карточку вокруг.
 * Меню закрывается по Esc, клику вне его и после выбора пункта.
 */
export function actionMenu({ rootClass, listClass, trigger, actions, stopEscape = false }) {
  const menu = h("div", { class: listClass, role: "menu", hidden: true });
  const btn = h(
    "button",
    {
      type: "button",
      ...trigger.props,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      onclick: () => setOpen(menu.hidden),
    },
    trigger.content,
  );
  const root = h("div", { class: rootClass }, btn, menu);

  const onOutside = (event) => {
    if (!root.contains(event.target)) setOpen(false);
  };

  function setOpen(open) {
    if (open) {
      menu.replaceChildren(
        ...actions().map((a) =>
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
  }

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.hidden) return;
    event.preventDefault();
    if (stopEscape) event.stopPropagation();
    setOpen(false);
    btn.focus();
  });
  return root;
}
