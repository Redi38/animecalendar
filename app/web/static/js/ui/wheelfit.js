// Подгонка колеса под экран (как в Film Roulette): колесо должно целиком помещаться в окно вместе с подписью над ним,
// но не шире своей колонки и не меньше читаемого минимума.

const WHEEL_MIN = 240;
const WHEEL_MAX = 1040; // внутреннее разрешение canvas, больше растягивать нечего
const RESERVE = 8; // подпись теперь над колесом и уже входит в его верхний отступ; снизу нужен лишь небольшой запас
const BOTTOM_GAP = 16;
const TOOLBAR_JITTER = 150; // на телефоне адресная строка меняет высоту окна: такие изменения не пересчитываем

/** Размер колеса в px по доступным ширине и высоте. */
export function computeWheelSize(availableWidth, availableHeight) {
  return Math.min(Math.max(Math.min(availableWidth, availableHeight - RESERVE) - 4, WHEEL_MIN), WHEEL_MAX);
}

/**
 * Следит за окном и держит размер holder по computeWheelSize. Раскрытие панели настроек колесо не трогает:
 * если панель стоит над колесом, её высота вычитается из отступа сверху, иначе колесо дёргалось бы при каждом открытии.
 * Возвращает функцию остановки.
 */
export function fitWheel({ holder, stage, dockBody }) {
  const touch = Boolean(window.matchMedia?.("(hover: none) and (pointer: coarse)").matches);
  let lastW = window.innerWidth;
  let lastH = window.innerHeight;
  let lastSize = 0;
  let frame = 0;
  let timer = 0;

  function apply() {
    frame = 0;
    const holderRect = holder.getBoundingClientRect();
    // Высоту раскрытой панели вычитаем, только если она стоит над колесом (узкий экран); справа от колеса она его не двигает.
    const above = dockBody && dockBody.getBoundingClientRect().bottom <= holderRect.top + 1;
    const top = holderRect.top + window.scrollY - (above ? dockBody.offsetHeight : 0);
    const size = Math.round(computeWheelSize(stage.clientWidth, window.innerHeight - top - BOTTOM_GAP));
    if (size === lastSize) return;
    lastSize = size;
    holder.style.setProperty("--wheel-size", `${size}px`);
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };

  function onResize() {
    const dw = Math.abs(window.innerWidth - lastW);
    const dh = Math.abs(window.innerHeight - lastH);
    lastW = window.innerWidth;
    lastH = window.innerHeight;
    if (dw < 1 && dh < 1) return;
    if (touch && dw < 1 && dh < TOOLBAR_JITTER) return;
    clearTimeout(timer);
    timer = setTimeout(schedule, 100);
  }

  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", schedule);
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
  observer?.observe(stage);
  document.fonts?.ready.then(schedule).catch(() => {});
  schedule();

  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", schedule);
    observer?.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  };
}
