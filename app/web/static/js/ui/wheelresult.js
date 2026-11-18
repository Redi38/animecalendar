import { api } from "../api.js";
import { coverEl, planButton, statusChip, watchButton } from "./card.js";
import { h } from "../util.js";

const CHEVRON = '<svg class="wheel-card-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';

/**
 * Карточка выпавшего тайтла под колесом. Свёрнутая показывает обложку и название, раскрывается как выпадающий список:
 * при первом раскрытии подгружает подробности (формат, сезон, оценка, описание) и даёт кнопки действий.
 * Возвращает { el, cancel }: cancel прерывает загрузку, когда карточку убрали.
 */
export function wheelResult(item) {
  const request = new AbortController();
  let loaded = false;

  const body = h("div", { class: "wheel-card-body" });
  const inner = h("div", { class: "wheel-card-inner" });
  body.append(inner);
  const head = h(
    "button",
    { class: "wheel-card-head", type: "button", "aria-expanded": "false", onclick: toggle },
    coverEl(item, "cover cover-sm"),
    h("span", { class: "wheel-card-text" }, h("span", { class: "wheel-card-label" }, "Выпало"), h("span", { class: "wheel-card-title" }, item.title)),
  );
  head.insertAdjacentHTML("beforeend", CHEVRON);
  const el = h("div", { class: "wheel-card" }, head, body);

  function toggle() {
    const open = head.getAttribute("aria-expanded") !== "true";
    head.setAttribute("aria-expanded", String(open));
    el.classList.toggle("open", open);
    if (open && !loaded) load();
  }

  async function load() {
    loaded = true;
    inner.replaceChildren(h("p", { class: "wheel-card-note", role: "status" }, "Загружаем описание…"));
    try {
      show(await api.title(item.id, request.signal));
    } catch (err) {
      if (err.name === "AbortError") return;
      loaded = false; // следующее раскрытие попробует снова
      inner.replaceChildren(h("p", { class: "wheel-card-note", role: "alert" }, `Не удалось загрузить: ${err.message}`), actions());
    }
  }

  function actions() {
    return h(
      "div",
      { class: "wheel-card-actions" },
      watchButton(item, { variant: "text" }),
      planButton(item, { variant: "text" }),
      h("a", { class: "btn", href: `#/title/${item.id}` }, "Открыть карточку"),
    );
  }

  function show(d) {
    const chips = [statusChip(d), d.format_ru, d.season_label, d.score ? `★ ${d.score}` : null].filter(Boolean);
    inner.replaceChildren(
      h("div", { class: "chip-row" }, chips.map((c) => (typeof c === "string" ? h("span", { class: "chip" }, c) : c))),
      d.description ? h("p", { class: "wheel-card-desc", lang: d.description_lang === "en" ? "en" : "ru" }, d.description) : null,
      actions(),
    );
  }

  return { el, cancel: () => request.abort() };
}
