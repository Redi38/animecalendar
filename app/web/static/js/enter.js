// Анимация появления страницы и карточек включается только на момент перехода: html[data-enter] живёт недолго
// и снимается при первом касании или нажатии клавиши, чтобы перерисовка списка (ввод в фильтр, дозагрузка связей)
// не запускала её снова.

const ENTER_MS = 2500;

export function createPageEnter(view) {
  let timer = 0;

  function stop() {
    delete document.documentElement.dataset.enter;
    clearTimeout(timer);
  }

  for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, stop, { capture: true });

  return {
    play() {
      document.documentElement.dataset.enter = "1";
      view.classList.remove("page-enter");
      void view.offsetWidth; // перезапуск CSS-анимации
      view.classList.add("page-enter");
      clearTimeout(timer);
      timer = setTimeout(stop, ENTER_MS);
    },
  };
}
