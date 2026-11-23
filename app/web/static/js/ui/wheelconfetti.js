// Конфетти над колесом, когда оно остановилось (как в Film Roulette). Холст лежит поверх страницы и не ловит клики.

const FALLBACK_COLORS = ["#8b7cf6"];

/** Цвета берём из --confetti-colors (wheel.css), чтобы палитра жила в одном месте. */
function palette() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--confetti-colors");
  const colors = raw.trim().split(/\s+/).filter(Boolean);
  return colors.length ? colors : FALLBACK_COLORS;
}
const DURATION_MS = 5200;
const GRAVITY = 0.1;

/** Запускает залп над элементом el. Возвращает функцию, которая убирает конфетти сразу (при уходе со страницы). */
export function fireWheelConfetti(el) {
  const noop = () => {};
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return noop;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return noop;

  const canvas = document.createElement("canvas");
  canvas.className = "wheel-confetti-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  document.body.append(canvas);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const cx = rect.width / 2;
  const cy = rect.height * 0.42;
  const count = Math.round(Math.min(280, Math.max(150, rect.width / 1.8)));
  const fadeFrom = DURATION_MS * 0.72;
  const colors = palette();

  const particles = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 9;
    return {
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3.5,
      drag: 0.985 + Math.random() * 0.01,
      size: 6 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.5,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.03 + Math.random() * 0.04,
    };
  });

  let raf = 0;
  const start = performance.now();
  const stop = () => {
    cancelAnimationFrame(raf);
    canvas.remove();
  };
  const frame = (now) => {
    const t = now - start;
    const life = t <= fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / (DURATION_MS - fadeFrom));
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const p of particles) {
      p.vy += GRAVITY;
      p.vx *= p.drag;
      p.sway += p.swaySpeed;
      p.x += p.vx + Math.sin(p.sway) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = life;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (t < DURATION_MS) raf = requestAnimationFrame(frame);
    else stop();
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
