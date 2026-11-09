import { api } from "../api.js";
import { groupRelations } from "../relations.js";
import { formatEpisodes, formatStart, h } from "../util.js";
import { coverEl, statusChip, watchButton } from "./card.js";

let watchTemplate = "";
let watchExact = false;

/** Настройки «Смотреть онлайн» приходят с сервера (/api/meta). Пустой шаблон — кнопки нет. */
export function setWatchTemplate(template, exact = false) {
  watchTemplate = template || "";
  watchExact = Boolean(exact);
}

/** Заменяет ссылку-поиск на точную страницу тайтла, когда сервер её нашёл. Не нашёл — остаётся поиск. */
export function upgradeWatchLink(holder, d, signal) {
  const link = holder.querySelector(".watch-online");
  if (!watchExact || !link) return;
  api
    .watchPage(d.id, signal)
    .then((res) => {
      if (signal.aborted || !res.url || !link.isConnected) return;
      link.href = res.url;
      link.dataset.exact = "1";
      link.title = "Страница этого тайтла на сайте";
    })
    .catch(() => {
      /* не нашли — остаёмся на ссылке-поиске */
    });
}

/** Ссылка поиска по названию; null, если сервис не настроен или тайтл ещё не вышел. */
export function watchOnlineUrl(template, d) {
  if (!template || d.status === "NOT_YET_RELEASED" || d.status === "CANCELLED") return null;
  return template.replace("{q}", encodeURIComponent(d.title));
}

function fact(label, value) {
  return value ? h("div", { class: "fact" }, h("dt", null, label), h("dd", null, value)) : null;
}

/** Студии через запятую: если известен ID, название ведёт на страницу студии со всеми её тайтлами. */
function studioLinks(studios) {
  if (!studios.length) return null;
  return studios.flatMap((s, i) => [
    i ? ", " : null,
    s.id ? h("a", { class: "studio-link", href: `#/studio/${s.id}` }, s.name) : s.name,
  ]);
}

function relationRow(rel) {
  const when = formatStart(rel.start, rel.start_precision, "short");
  return h(
    "li",
    { class: "rel-row" },
    h(
      "a",
      { class: "rel-link", href: `#/title/${rel.id}` },
      coverEl(rel, "cover cover-sm"),
      h(
        "span",
        { class: "rel-text" },
        h("span", { class: "rel-kind" }, rel.relation_ru),
        h("span", { class: "rel-title" }, rel.title),
        h("span", { class: "rel-meta" }, [rel.format_ru, rel.status_ru, when].filter(Boolean).join(" · ")),
      ),
    ),
    watchButton(rel),
  );
}

function watchOnlineLink(d) {
  const url = watchOnlineUrl(watchTemplate, d);
  if (!url) return null;
  return h(
    "a",
    { class: "btn btn-primary watch-online", href: url, target: "_blank", rel: "noopener noreferrer" },
    "▶ Смотреть онлайн",
  );
}

/** Содержимое карточки тайтла: шапка, факты, описание, связанные тайтлы. */
export function titleBody(d) {
  const episodes = formatEpisodes(d.episodes);
  const duration = d.duration ? `${d.duration} мин.` : null;
  const next = d.next_episode
    ? `Серия ${d.next_episode.number ?? "?"}: ${new Date(d.next_episode.at * 1000).toLocaleString("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`
    : null;
  return [
    h(
      "div",
      { class: "dialog-head" },
      coverEl(d, "cover cover-lg"),
      h(
        "div",
        { class: "dialog-info" },
        h("h2", { id: "dialog-title" }, d.title),
        d.subtitle ? h("p", { class: "dialog-sub", lang: "en" }, d.subtitle) : null,
        d.title_native && d.title_native !== d.subtitle && d.title_native !== d.title
          ? h("p", { class: "dialog-sub", lang: "ja" }, d.title_native)
          : null,
        h(
          "div",
          { class: "chip-row" },
          statusChip(d),
          d.format_ru ? h("span", { class: "chip" }, d.format_ru) : null,
          d.season_label ? h("span", { class: "chip" }, d.season_label) : null,
          d.score ? h("span", { class: "chip" }, `★ ${d.score}`) : null,
        ),
        h("div", { class: "dialog-actions" }, watchButton(d, { variant: "text" }), watchOnlineLink(d)),
      ),
    ),
    h(
      "dl",
      { class: "facts" },
      fact("Премьера", formatStart(d.start, d.start_precision)),
      fact("Серий", episodes),
      fact("Длительность", duration),
      fact("Следующая серия", next),
      fact("Студия", studioLinks(d.studios)),
      fact("Первоисточник", d.source_ru),
      fact("Жанры", d.genres.join(", ")),
    ),
    d.description
      ? h(
          "section",
          { class: "dialog-section" },
          h("h3", null, "Описание"),
          d.description_lang === "en"
            ? h("p", { class: "muted small" }, "Русского описания нет — показано оригинальное, на английском.")
            : null,
          h("p", { class: "description", lang: d.description_lang === "en" ? "en" : "ru" }, d.description),
        )
      : null,
    d.relations.length
      ? h(
          "section",
          { class: "dialog-section" },
          h("h3", null, `Связанные тайтлы (${d.relations.length})`),
          groupRelations(d.relations).map((g) =>
            h(
              "div",
              { class: "rel-group", "data-group": g.key },
              h("h4", { class: "rel-group-title" }, `${g.title} (${g.items.length})`),
              h("ul", { class: "rel-list" }, g.items.map(relationRow)),
            ),
          ),
        )
      : null,
  ];
}
