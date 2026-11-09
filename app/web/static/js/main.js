import { api } from "./api.js";
import { store } from "./store.js";
import { syncWatchButtons } from "./ui/card.js";
import { errorBox } from "./ui/error.js";
import { closeTitleDialog, openTitleDialog, setWatchTemplate } from "./ui/modal.js";
import { closeDialogAnimated, replayEnter } from "./ui/motion.js";
import { replaceDialog } from "./ui/replace.js";
import { initSearch } from "./ui/search.js";
import { toast } from "./ui/toast.js";
import { initSync } from "./ui/sync.js";
import { createPageEnter } from "./enter.js";
import { createRelated } from "./related.js";
import { navName, parseRoute } from "./router.js";
import { createTitleActions } from "./titleactions.js";
import { initThemeToggle } from "./theme.js";
import { renderSearch } from "./views/search.js";
import { renderSeason } from "./views/season.js";
import { renderIgnored } from "./views/ignored.js";
import { renderTba } from "./views/tba.js";
import { renderUpcoming } from "./views/upcoming.js";
import { renderWatched } from "./views/watched.js";

const view = document.getElementById("view");
const badge = document.getElementById("nav-badge");
const count = document.getElementById("nav-count");

const related = createRelated({
  store,
  api,
  onUpdate: () => {
    updateBadge();
    current?.refresh?.();
  },
});

const ctx = {
  meta: null,
  store,
  get relatedIds() {
    return related.ids;
  },
  get relatedData() {
    return related.data;
  },
  loadRelated: related.load,
  updateBadge,
};

function updateBadge() {
  const data = related.data;
  const fresh = data && store.seenReady() ? data.items.filter((i) => !store.isSeen(i.id) && !store.isIgnored(i.id)).length : 0;
  badge.hidden = fresh === 0;
  badge.textContent = fresh > 99 ? "99+" : String(fresh);
  badge.setAttribute("aria-label", `Новых анонсов: ${fresh}`);
  count.textContent = store.size() ? String(store.size()) : "";
}

let subscribedKey = related.listKey();
store.subscribe((source) => {
  syncWatchButtons();
  updateBadge();
  // Список обновила синхронизация с другого устройства: открытая страница перерисовывается сразу.
  if (source === "sync") current?.refresh?.();
  // Анонсы зависят только от списка просмотренного: скрытие и возврат тайтла не должны перерисовывать страницу второй раз.
  const key = related.listKey();
  if (key === subscribedKey) return;
  subscribedKey = key;
  related.refreshSoon();
});

// --- маршрутизация ---------------------------------------------------------------

let current = null; // { cleanup, refresh } активного экрана
let navId = 0;
let baseHash = null; // страница под открытой карточкой
const pageTitle = "Аниме-календарь"; // название вкладки браузера не меняется при переходах между разделами

initThemeToggle(document.getElementById("theme-toggle"));
const search = initSearch();

function markNav(name) {
  for (const a of document.querySelectorAll("[data-nav]")) {
    const active = a.dataset.nav === name || (name === "home" && a.dataset.nav === "season");
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

const pageEnter = createPageEnter(view);

function showPage(route) {
  const myNav = ++navId;
  const isCurrent = () => myNav === navId;
  current?.cleanup?.();
  current = null;
  window.scrollTo(0, 0);
  baseHash = location.hash || "#/";
  markNav(navName(route));

  if (route.name === "home") {
    const { year, season } = ctx.meta.current;
    history.replaceState(null, "", `#/season/${year}/${season.toLowerCase()}`);
    return showPage({ name: "season", year, slug: season.toLowerCase() });
  }

  document.title = pageTitle;
  pageEnter.play();

  if (route.name === "season") current = renderSeason(view, route, ctx, isCurrent);
  else if (route.name === "tba") current = renderTba(view, ctx, isCurrent);
  else if (route.name === "watched") current = renderWatched(view, ctx, isCurrent);
  else if (route.name === "upcoming") current = renderUpcoming(view, ctx, isCurrent);
  else if (route.name === "ignored") current = renderIgnored(view, ctx, isCurrent);
  else if (route.name === "search") {
    search.setValue(route.q);
    current = renderSearch(view, route, ctx, isCurrent);
  }
  if (route.name !== "search") search.reset();
  view.focus({ preventScroll: true });
}

const titleActions = createTitleActions({
  store,
  toast,
  pickTitle: replaceDialog,
  closeToBase,
  goTo: (hash) => location.replace(hash),
});

// Адрес страницы под карточкой (или главная, если карточку открыли ссылкой напрямую).
function pageUnderDialog() {
  return baseHash && !baseHash.startsWith("#/title/") ? baseHash : "#/";
}

// Закрывает карточку и перерисовывает страницу под ней: список мог измениться.
function closeToBase() {
  history.replaceState(null, "", pageUnderDialog());
  document.title = pageTitle;
  closeDialogAnimated(document.getElementById("title-dialog")); // карточка закрывается плавно, как по крестику
  current?.refresh?.();
  replayEnter(view); // оставшиеся карточки выезжают заново, список заметно меняется
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
    openTitleDialog(
      route.id,
      () => {
        // Пользователь закрыл окно сам — возвращаем адрес страницы под ним.
        history.replaceState(null, "", pageUnderDialog());
        document.title = pageTitle;
      },
      titleActions.forPage(baseHash),
    );
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
    setWatchTemplate(ctx.meta.watch_url, ctx.meta.watch_exact);
  } catch (err) {
    view.replaceChildren(errorBox(err.message, { onRetry: () => location.reload(), retryLabel: "Обновить страницу" }));
    return;
  }
  updateBadge();
  initSync(ctx.meta.google_client_id, Boolean(ctx.meta.google_persistent));
  window.addEventListener("hashchange", onRoute);
  onRoute();
  // Прогреваем анонсы для значка на вкладке, не мешая основному экрану.
  if (store.size()) related.refreshSoon();
}

window.addEventListener("unhandledrejection", (event) => {
  if (event.reason?.name === "AbortError") return;
  console.error(event.reason);
  toast("Что-то пошло не так. Попробуйте обновить страницу.", "error");
});

start();
