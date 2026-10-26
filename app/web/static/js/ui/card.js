import { store, MAX_WATCHED } from "../store.js";
import { formatEpisodes, formatStart, h, safeColor, untilText } from "../util.js";
import { toast } from "./toast.js";

const EYE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function icon(svg) {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = svg; // статичная разметка из констант выше, данных API здесь нет
  return span;
}

/** Кнопка «Смотрел». Состояние синхронизируется через syncWatchButtons(). */
export function watchButton(item, { variant = "icon" } = {}) {
  const btn = h("button", {
    type: "button",
    class: `watch-btn watch-${variant}`,
    "data-watch-id": item.id,
    "data-title": item.title,
    onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!store.toggle(item.id)) toast(`В списке может быть не больше ${MAX_WATCHED} тайтлов.`, "error");
    },
  });
  paintWatchButton(btn);
  return btn;
}

function paintWatchButton(btn) {
  const on = store.has(Number(btn.dataset.watchId));
  const variant = btn.classList.contains("watch-text");
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.replaceChildren(icon(on ? CHECK : EYE));
  if (variant) btn.append(on ? "Просмотрено" : "Отметить просмотренным");
  const name = btn.dataset.title || "";
  btn.setAttribute("aria-label", on ? `Убрать из просмотренного: ${name}` : `Отметить просмотренным: ${name}`);
  btn.title = on ? "Просмотрено — нажмите, чтобы убрать" : "Отметить просмотренным";
  btn.closest(".tcard, .rel-row")?.classList.toggle("is-watched", on);
}

export function syncWatchButtons(root = document) {
  for (const btn of root.querySelectorAll("[data-watch-id]")) paintWatchButton(btn);
}

function initial(title) {
  return (title || "?").trim().charAt(0).toUpperCase();
}

export function statusChip(item) {
  if (!item.status_ru) return null;
  return h("span", { class: `chip status-${(item.status || "").toLowerCase()}` }, item.status_ru);
}

export function coverEl(item, className = "cover") {
  const color = safeColor(item.color);
  return h(
    "span",
    { class: className, style: color ? `--c:${color}` : null },
    item.cover
      ? h("img", { src: item.cover, alt: "", loading: "lazy", decoding: "async" })
      : h("span", { class: "ph", "aria-hidden": "true" }, initial(item.title)),
  );
}

/**
 * Карточка тайтла для сеток.
 * opts.showDate — показывать дату премьеры в строке метаданных (в сезонной сетке дата уже в заголовке группы)
 * opts.showRelation — показывать «Продолжение · из «…»» (вкладка анонсов)
 * opts.isNew — значок «Новое»
 * opts.related — значок «Связано с вашим списком»
 */
export function titleCard(item, opts = {}) {
  const href = `#/title/${item.id}`;
  const episodes = formatEpisodes(item.episodes);
  const meta = [opts.showDate ? formatStart(item.start, item.start_precision, "short") : null, item.format_ru, episodes]
    .filter(Boolean)
    .join(" · ");

  const card = h(
    "article",
    { class: "tcard", "data-id": item.id },
    h(
      "a",
      { class: "cover-link", href, tabindex: "-1", "aria-hidden": "true" },
      coverEl(item),
      h(
        "span",
        { class: "cover-badges" },
        statusChip(item),
        opts.isNew ? h("span", { class: "chip chip-new" }, "Новое") : null,
      ),
    ),
    watchButton(item),
    h(
      "div",
      { class: "tcard-body" },
      h("h3", { class: "tcard-title" }, h("a", { href }, item.title)),
      item.subtitle ? h("p", { class: "tcard-sub", lang: "en" }, item.subtitle) : null,
      meta ? h("p", { class: "tcard-meta" }, meta) : null,
      item.next_episode
        ? h(
            "p",
            { class: "tcard-next" },
            `Серия ${item.next_episode.number ?? "?"} — ${untilText(item.next_episode.at)}`,
          )
        : null,
      opts.showRelation && item.relation_ru
        ? h(
            "p",
            { class: "tcard-rel" },
            h("strong", null, item.relation_ru),
            item.via ? ` · из «${item.via.title}»` : null,
            item.also_via ? ` и ещё ${item.also_via}` : null,
          )
        : null,
      opts.related ? h("p", { class: "tcard-rel" }, "★ Связано с вашим списком") : null,
      item.genres?.length ? h("p", { class: "tcard-genres" }, item.genres.slice(0, 3).join(", ")) : null,
    ),
  );
  card.classList.toggle("is-watched", store.has(item.id));
  return card;
}
