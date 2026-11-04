import { h } from "../util.js";

/** Индекс пункта после нажатия клавиши навигации (без зацикливания). */
export function nextIndex(key, current, count) {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return Math.min(current + 1, count - 1);
  if (key === "ArrowUp") return Math.max(current - 1, 0);
  return current;
}

let uid = 0;

/**
 * Выпадающий список вместо системного <select>: меню плавно появляется и исчезает, стрелка переворачивается.
 * options: [{ id, label }]; onChange(id) вызывается только при смене значения. Клавиатура: стрелки, Home/End,
 * Enter/пробел выбирают, Esc закрывает.
 */
export function dropdown({ label, options, value, onChange, triggerText = null }) {
  const id = `dd-${++uid}`;
  let current = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  let isOpen = false;

  // Все подписи лежат в одной ячейке сетки: ширина кнопки равна самой длинной, и она не «прыгает» при смене пункта.
  // triggerText — постоянная подпись на кнопке (например, «Сортировка»); выбранный пункт виден в самом меню.
  const valueEls = triggerText
    ? [h("span", { class: "is-current" }, triggerText)]
    : options.map((o, i) => h("span", { class: i === current ? "is-current" : "" }, o.label));
  const trigger = h(
    "button",
    {
      type: "button",
      class: "dropdown-trigger",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
      "aria-controls": `${id}-menu`,
      "aria-label": `${label}: ${options[current].label}`,
      onclick: () => setOpen(!isOpen),
    },
    h("span", { class: "dropdown-value" }, valueEls),
    h("span", { class: "dropdown-chevron", "aria-hidden": "true" }),
  );
  const items = options.map((o, i) =>
    h(
      "li",
      {
        class: "dropdown-option",
        role: "option",
        id: `${id}-opt-${i}`,
        tabindex: "-1",
        "aria-selected": String(i === current),
        onclick: () => choose(i),
      },
      o.label,
    ),
  );
  const menu = h("ul", { class: "dropdown-menu", role: "listbox", id: `${id}-menu`, "aria-label": label }, items);
  const root = h("div", { class: "dropdown" }, trigger, menu);

  const onOutside = (event) => {
    if (!root.contains(event.target)) setOpen(false);
  };

  function setOpen(next) {
    if (next === isOpen) return;
    isOpen = next;
    root.classList.toggle("is-open", isOpen);
    trigger.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      document.addEventListener("pointerdown", onOutside, true);
      items[current].focus({ preventScroll: true });
    } else {
      document.removeEventListener("pointerdown", onOutside, true);
    }
  }

  function choose(index) {
    const changed = index !== current;
    current = index;
    items.forEach((el, i) => el.setAttribute("aria-selected", String(i === index)));
    if (!triggerText) valueEls.forEach((el, i) => el.classList.toggle("is-current", i === index));
    trigger.setAttribute("aria-label", `${label}: ${options[index].label}`);
    setOpen(false);
    trigger.focus({ preventScroll: true });
    if (changed) onChange(options[index].id);
  }

  root.addEventListener("keydown", (event) => {
    if (!isOpen) {
      if (event.target === trigger && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    const focused = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.focus({ preventScroll: true });
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      items[nextIndex(event.key, focused < 0 ? current : focused, items.length)].focus({ preventScroll: true });
    } else if ((event.key === "Enter" || event.key === " ") && focused >= 0) {
      event.preventDefault();
      choose(focused);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  });

  return root;
}
