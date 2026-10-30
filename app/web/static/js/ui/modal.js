import { api } from "../api.js";
import { clear, formatEpisodes, formatStart, h } from "../util.js";
import { coverEl, statusChip, watchButton } from "./card.js";
import { closeDialogAnimated, fadeOut, reducedMotion } from "./motion.js";

let watchTemplate = "";

/** Шаблон ссылки «Смотреть онлайн» приходит с сервера (/api/meta); пустой — кнопки нет. */
export function setWatchTemplate(template) {
  watchTemplate = template || "";
}

/** Ссылка поиска по названию; null, если сервис не настроен или тайтл ещё не вышел. */
export function watchOnlineUrl(template, d) {
  if (!template || d.status === "NOT_YET_RELEASED" || d.status === "CANCELLED") return null;
  return template.replace("{q}", encodeURIComponent(d.title));
}

function fact(label, value) {
  return value ? h("div", { class: "fact" }, h("dt", null, label), h("dd", null, value)) : null;
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

function body(d) {
  const episodes = formatEpisodes(d.episodes);
  const duration = d.duration ? `${d.duration} мин.` : null;
  const next = d.next_episode
    ? `Серия ${d.next_episode.number ?? "?"}: ${new Date(d.next_episode.at * 1000).toLocaleString("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`
    : null;
  const links = [
    d.links.shikimori ? h("a", { href: d.links.shikimori, target: "_blank", rel: "noopener noreferrer" }, "Shikimori") : null,
    d.links.anilist ? h("a", { href: d.links.anilist, target: "_blank", rel: "noopener noreferrer" }, "AniList") : null,
    d.links.mal ? h("a", { href: d.links.mal, target: "_blank", rel: "noopener noreferrer" }, "MyAnimeList") : null,
  ].filter(Boolean);

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
      fact("Студия", d.studios.join(", ")),
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
          h("ul", { class: "rel-list" }, d.relations.map(relationRow)),
        )
      : null,
    links.length
      ? h("p", { class: "ext-links" }, "Подробнее: ", links.flatMap((a, i) => (i ? [" · ", a] : [a])))
      : null,
  ];
}

let controller = null;

/** Открывает карточку. onClose вызывается, когда пользователь закрыл окно сам (Esc, крестик, клик по фону). */
export function openTitleDialog(id, onClose) {
  const dialog = document.getElementById("title-dialog");
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;

  dialog.classList.remove("is-closing"); // если окно как раз закрывалось, отменяем закрытие
  const wasOpen = dialog.open;
  const oldBody = dialog.querySelector(".dialog-body");
  // Переход между связанными тайтлами: старое содержимое плавно гаснет, пока грузится новое.
  const leave = wasOpen && oldBody && !reducedMotion() ? fadeOut(oldBody) : Promise.resolve();
  const request = api.title(id, signal);
  request.catch(() => {}); // ошибку разберёт цепочка ниже; здесь только чтобы не было «unhandled»

  dialog.oncancel = (event) => {
    event.preventDefault(); // Esc: закрываем с анимацией
    closeDialogAnimated(dialog);
  };
  dialog.onclose = () => {
    if (dialog.dataset.silent) return;
    onClose();
  };
  dialog.onclick = (event) => {
    if (event.target === dialog) closeDialogAnimated(dialog);
  };

  leave.then(() => {
    if (signal.aborted) return;
    const close = h("button", { type: "button", class: "dialog-close", "aria-label": "Закрыть", onclick: () => closeDialogAnimated(dialog) }, "✕");
    clear(dialog).append(close, h("div", { class: "dialog-body" }, h("div", { class: "loading", role: "status" }, "Загружаем…")));
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  });

  Promise.all([request, leave])
    .then(([d]) => {
      if (signal.aborted) return;
      const holder = dialog.querySelector(".dialog-body");
      clear(holder).append(...body(d));
      holder.classList.add("is-entering");
      setTimeout(() => holder.classList.remove("is-entering"), 900);
      dialog.scrollTop = 0;
      document.title = `${d.title} — Аниме-календарь`;
    })
    .catch((err) => {
      if (err.name === "AbortError" || signal.aborted) return;
      const holder = dialog.querySelector(".dialog-body");
      clear(holder).append(
        h(
          "div",
          { class: "error-box", role: "alert" },
          h("h2", { id: "dialog-title" }, err.status === 404 ? "Тайтл не найден" : "Не удалось загрузить"),
          h("p", null, err.message),
        ),
      );
    });
}

/** Закрыть окно программно (например, при переходе на другую страницу) без вызова onClose. */
export function closeTitleDialog() {
  controller?.abort();
  const dialog = document.getElementById("title-dialog");
  if (dialog.open) {
    dialog.dataset.silent = "1";
    dialog.close();
    delete dialog.dataset.silent;
  }
}

