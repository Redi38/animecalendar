// Классический (не модульный) скрипт в <head>: ставит тему до первой отрисовки, чтобы не было вспышки.
// Логика та же, что в theme.js (resolveTheme); CSP не разрешает inline-скрипты, поэтому это отдельный файл.
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem("anime_calendar_theme");
  } catch (e) {
    /* хранилище недоступно — берём системную тему */
  }
  var light = stored === "light" || (stored !== "dark" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
})();
