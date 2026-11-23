// Холостой ход колеса: пока его никто не крутит, оно медленно ползёт, как плёнка.

import { prefersReducedMotion } from "./wheelcanvas.js";

/**
 * degPerSec — скорость; canDrift() — можно ли сейчас двигать колесо; onDrift(deg) — на сколько градусов сдвинуть.
 * При «уменьшить движение» ничего не запускает. Возвращает функцию остановки.
 */
export function startWheelIdle({ degPerSec, canDrift, onDrift }) {
  if (prefersReducedMotion()) return () => {};
  let last = performance.now();
  let frame = 0;
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (canDrift()) onDrift(degPerSec * dt);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
