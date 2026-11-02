import { h } from "../util.js";

/** Блок ошибки; кнопка «Повторить» появляется, если передан onRetry. */
export function errorBox(message, { onRetry, retryLabel = "Повторить" } = {}) {
  return h(
    "div",
    { class: "error-box", role: "alert" },
    h("p", null, message),
    onRetry ? h("button", { type: "button", class: "btn", onclick: onRetry }, retryLabel) : null,
  );
}
