import { api } from "./api.js";
import { store } from "./store.js";
import { syncWatchButtons } from "./ui/card.js";
import { closeTitleDialog, openTitleDialog } from "./ui/modal.js";
import { initSearch } from "./ui/search.js";
import { toast } from "./ui/toast.js";
import { debounce, h } from "./util.js";
import { renderSearch } from "./views/search.js";
import { renderSeason } from "./views/season.js";
import { renderTba } from "./views/tba.js";
import { renderUpcoming } from "./views/upcoming.js";
import { renderWatched } from "./views/watched.js";

const view = document.getElementById("view");
const badge = document.getElementById("nav-badge");
const count = document.getElementById("nav-count");

const ctx = {
  meta: null,
  store,
  relatedIds: new Set(), // тайтлы, связанные с просмотренными (для отметок в сезонной сетке)
  relatedData: null,
  _relatedPromise: null,
  _relatedKey: "",
  loadRelated,
  updateBadge,
};

// --- связанные анонсы: один запрос на состояние списка --------------------------

function listKey() {
  return store.ids().sort((a, b) => a - b).join(",");
}

function loadRelated() {
  const key = listKey();
  if (!key) {
    ctx.relatedData = { items: [], degraded: false };
    ctx.relatedIds = new Set();
    ctx._relatedKey = "";
    return Promise.resolve(ctx.relatedData);
  }
  if (ctx.relatedData && ctx._relatedKey === key && !ctx.relatedData.degraded) return Promise.resolve(ctx.relatedData);
  if (ctx._relatedPromise && ctx._relatedPromiseKey === key) return ctx._relatedPromise;

  ctx._relatedPromiseKey = key;
  ctx._relatedPromise = api
    .related(store.ids())
    .then((data) => {
      if (listKey() !== key) return loadRelated(); // список изменился, пока шёл запрос
      ctx.relatedData = data;
      ctx._relatedKey = key;
      ctx.relatedIds = new Set(data.items.map((i) => i.id));
      return data;
    })
    .finally(() => {
      if (ctx._relatedPromiseKey === key) ctx._relatedPromise = null;
    });
  return ctx._relatedPromise;
}

function updateBadge() {
  const data = ctx.relatedData;
  const fresh = data && store.seenReady() ? data.items.filter((i) => !store.isSeen(i.id)).length : 0;
  badge.hidden = fresh === 0;
  badge.textContent = fresh > 99 ? "99+" : String(fresh);
  badge.setAttribute("aria-label", `Новых анонсов: ${fresh}`);
  count.textContent = store.size() ? String(store.size()) : "";
}

// Фоновое обновление отметок после изменения списка.
const refreshRelatedSoon = debounce(() => {
  loadRelated()
    .then(() => {
      updateBadge();
      current?.refresh?.();
    })
    .catch(() => {
      /* вкладка анонсов сама покажет ошибку, когда её откроют */
    });
}, 700);

store.subscribe(() => {
  syncWatchButtons();
  updateBadge();
  refreshRelatedSoon();
});

// --- маршрутизация ---------------------------------------------------------------

let current = null; // { cleanup, refresh } активного экрана
let navId = 0;
let baseHash = null; // страница под открытой карточкой
let pageTitle = "Аниме-календарь";

const search = initSearch();

function parseRoute(hash) {
  const path = hash.replace(/^#/, "") || "/";
  let m;
  if ((m = path.match(/^\/title\/(\d+)$/))) return { name: "title", id: Number(m[1]) };
  if ((m = path.match(/^\/season\/(\d{4})\/(winter|spring|summer|fall)$/))) {
    return { name: "season", year: Number(m[1]), slug: m[2] };
  }
  if ((m = path.match(/^\/search\/(.+)$/))) {
    try {
      return { name: "search", q: decodeURIComponent(m[1]).slice(0, 100) };
    } catch {
      return { name: "home" };
    }
  }
  if (path === "/tba") return { name: "tba" };
  if (path === "/watched") return { name: "watched" };
  if (path === "/upcoming") return { name: "upcoming" };
  return { name: "home" };
}

function markNav(name) {
  for (const a of document.querySelectorAll("[data-nav]")) {
    const active = a.dataset.nav === name || (name === "home" && a.dataset.nav === "season");
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

function showPage(route) {
  const myNav = ++navId;
  const isCurrent = () => myNav === navId;
  current?.cleanup?.();
  current = null;
  window.scrollTo(0, 0);
  baseHash = location.hash || "#/";
  markNav(route.name === "season" || route.name === "tba" ? "season" : route.name);

  if (route.name === "home") {
    const { year, season } = ctx.meta.current;
    history.replaceState(null, "", `#/season/${year}/${season.toLowerCase()}`);
    return showPage({ name: "season", year, slug: season.toLowerCase() });
  }

  const titles = {
    season: () => `${ctx.meta.seasons.find((s) => s.slug === route.slug)?.label} ${route.year}`,
    tba: () => "Анонсы без даты",
    watched: () => "Просмотрено",
    upcoming: () => "Мои анонсы",
    search: () => `Поиск: ${route.q}`,
  };
  pageTitle = `${titles[route.name]()} — Аниме-календарь`;
  document.title = pageTitle;

  if (route.name === "season") current = renderSeason(view, route, ctx, isCurrent);
  else if (route.name === "tba") current = renderTba(view, ctx, isCurrent);
  else if (route.name === "watched") current = renderWatched(view, ctx, isCurrent);
  else if (route.name === "upcoming") current = renderUpcoming(view, ctx, isCurrent);
  else if (route.name === "search") {
    search.setValue(route.q);
    current = renderSearch(view, route, ctx, isCurrent);
  }
  if (route.name !== "search") search.reset();
  view.focus({ preventScroll: true });
}

function onRoute() {
  if (!ctx.meta) return;
  const route = parseRoute(location.hash);
  if (route.name === "title") {
    if (!view.childElementCount) {
      // Ссылку на тайтл открыли напрямую: под карточкой показываем текущий сезон.
      const { year, season } = ctx.meta.current;
      baseHash = `#/season/${year}/${season.toLowerCase()}`;
      showPage({ name: "season", year, slug: season.toLowerCase() });
    }
    openTitleDialog(route.id, () => {
      // Пользователь закрыл окно сам — возвращаем адрес страницы под ним.
      const target = baseHash && !baseHash.startsWith("#/title/") ? baseHash : "#/";
      history.replaceState(null, "", target);
      document.title = pageTitle;
    });
    return;
  }
  const dialog = document.getElementById("title-dialog");
  if (dialog.open && location.hash === baseHash) {
    // «Назад» из карточки: страница под ней уже нарисована, не перерисовываем её и не теряем прокрутку.
    closeTitleDialog();
    document.title = pageTitle;
    return;
  }
  closeTitleDialog();
  showPage(route);
}

async function start() {
  try {
    ctx.meta = await api.meta();
  } catch (err) {
    view.replaceChildren(
      h(
        "div",
        { class: "error-box", role: "alert" },
        h("p", null, err.message),
        h("button", { type: "button", class: "btn", onclick: () => location.reload() }, "Обновить страницу"),
      ),
    );
    return;
  }
  if (ctx.meta.demo) {
    document.body.insertAdjacentElement(
      "afterbegin",
      h("div", { class: "demo-banner" }, "Демо-режим: показаны вымышленные тайтлы. Настоящие данные подключаются без демо-режима."),
    );
  }
  updateBadge();
  window.addEventListener("hashchange", onRoute);
  onRoute();
  // Прогреваем анонсы для значка на вкладке, не мешая основному экрану.
  if (store.size()) refreshRelatedSoon();
}

window.addEventListener("unhandledrejection", (event) => {
  if (event.reason?.name === "AbortError") return;
  console.error(event.reason);
  toast("Что-то пошло не так. Попробуйте обновить страницу.", "error");
});

start();
