import { storageGet, storageSet } from "./storage.js";

export const THEME_KEY = "anime_calendar_theme";

/** Выбор пользователя важнее системной темы; пока выбора нет, следуем системе. */
export function resolveTheme(stored, systemLight) {
  if (stored === "light" || stored === "dark") return stored;
  return systemLight ? "light" : "dark";
}

export function nextTheme(theme) {
  return theme === "light" ? "dark" : "light";
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim() || meta.content;
}

/** Кнопка-переключатель светлой и тёмной темы; выбор запоминается в браузере. */
export function initThemeToggle(button) {
  if (!button) return;
  const query = window.matchMedia("(prefers-color-scheme: light)");
  const hasChoice = () => ["light", "dark"].includes(storageGet(THEME_KEY));
  const current = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const paint = () => {
    const label = current() === "light" ? "Включить тёмную тему" : "Включить светлую тему";
    button.setAttribute("aria-label", label);
    button.title = label;
  };

  applyTheme(resolveTheme(storageGet(THEME_KEY), query.matches));
  paint();

  button.addEventListener("click", () => {
    const theme = nextTheme(current());
    storageSet(THEME_KEY, theme);
    applyTheme(theme);
    paint();
  });
  // Системная тема сменилась (например, закат): следуем ей, пока пользователь не выбрал сам.
  query.addEventListener?.("change", () => {
    if (hasChoice()) return;
    applyTheme(resolveTheme(null, query.matches));
    paint();
  });
}
