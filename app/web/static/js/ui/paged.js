import { h } from "../util.js";

/**
 * Кладёт в сетку карточки порциями: следующая порция рисуется, когда кнопка «Показать ещё» попадает в поле зрения
 * (или по нажатию на неё). makers — функции, создающие карточки; minShown — сколько показать сразу (чтобы после
 * перерисовки списка не терять уже раскрытое); onDrawn(n) получает, сколько карточек показано.
 * Возвращает функцию, которая отключает слежение за кнопкой (при перерисовке и уходе со страницы).
 */
export function mountPaged(grid, more, makers, { pageSize = 60, minShown = 0, onDrawn } = {}) {
  let drawn = 0;
  let observer = null;
  const btn = h("button", { class: "btn", type: "button", onclick: () => draw() }, "");
  const stop = () => observer?.disconnect();

  function draw() {
    const end = Math.min(makers.length, Math.max(drawn + pageSize, minShown));
    grid.append(...makers.slice(drawn, end).map((make) => make()));
    drawn = end;
    onDrawn?.(end);
    const left = makers.length - drawn;
    if (!left) {
      stop();
      more.remove();
      return;
    }
    btn.textContent = `Показать ещё (${left})`;
  }

  more.append(btn);
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && draw(), { rootMargin: "800px" });
    observer.observe(btn);
  }
  draw();
  return stop;
}
