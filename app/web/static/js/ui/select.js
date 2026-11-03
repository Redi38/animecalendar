import { h } from "../util.js";

/** Оборачивает <select>, чтобы стрелку рисовал CSS (.select-field) одинаково во всех браузерах. */
export function selectField(select) {
  return h("span", { class: "select-field" }, select);
}
