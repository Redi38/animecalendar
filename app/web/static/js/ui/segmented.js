import { h } from "../util.js";

/**
 * Переключатель из нескольких кнопок со скользящей подложкой под выбранной (как режимы в Film Roulette).
 * options: [[значение, подпись], ...]. Возвращает { el, set(value, disabled) }; onChange(value) зовётся при выборе другого.
 */
export function segmented({ options, value, onChange, label }) {
  const thumb = h("span", { class: "segmented-thumb", "aria-hidden": "true" });
  const buttons = options.map(([val, text]) =>
    h("button", { type: "button", class: "segmented-btn", "data-value": val, onclick: () => val !== current && onChange(val) }, text),
  );
  const el = h("div", { class: "segmented", role: "group", "aria-label": label }, thumb, ...buttons);
  let current = value;

  function place() {
    const active = buttons.find((b) => b.dataset.value === current);
    if (!active || !active.offsetWidth) return;
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function set(next, disabled = false) {
    current = next;
    for (const b of buttons) {
      const on = b.dataset.value === current;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
      b.disabled = disabled;
    }
    el.classList.toggle("is-disabled", disabled);
    place();
  }

  // Подложка встаёт по размерам кнопок, поэтому пересчитываем её, когда они появились на экране или изменились.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(place).observe(el);
  set(value);
  return { el, set };
}
