// Колесо рулетки: рисование сегментов на canvas и анимация вращения. Поворачивается сам canvas (CSS transform),
// поэтому колесо рисуется один раз на любой угол.

const SIZE = 1040; // внутреннее разрешение; на экране canvas сжимается стилями
const COLORS = ["#8b7cf6", "#5b8def", "#34d399", "#f2596b", "#f6c945", "#ef7fd1", "#5be3d0", "#f6975a", "#a78bfa", "#38bdf8", "#86d36f", "#fb7185"];
export const SPIN_MS = 5200;
const EXTRA_TURNS = 6;

/** Нужна ли короткая анимация: пользователь просил поменьше движения. */
export function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

const quartic = (t) => 1 - (1 - t) ** 4; // быстрый старт и долгий плавный хвост, как у колеса с трением

/** Цвет сегмента: соседние всегда разные, в том числе последний и первый. */
function colorOf(i, n) {
  if (n > 1 && i === n - 1 && i % COLORS.length === 0) return COLORS[COLORS.length - 1];
  return COLORS[i % COLORS.length];
}

/** Рисует колесо. highlight >= 0 — выпавший сегмент, остальные приглушены. */
export function drawWheel(canvas, labels, highlight = -1) {
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  const n = labels.length;
  const c = SIZE / 2;
  const r = c - 6;
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (!n) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(128,128,128,0.18)";
    ctx.fill();
    return;
  }
  const seg = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * seg;
    const a1 = a0 + seg;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = colorOf(i, n);
    ctx.fill();
    if (highlight >= 0 && i !== highlight) {
      ctx.fillStyle = "rgba(9,12,22,0.62)";
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(9,12,22,0.55)";
    ctx.lineWidth = n > 40 ? 2 : 4;
    ctx.stroke();

    const arc = seg * r * 0.9;
    if (arc < 28) continue; // такой узкий сегмент подпись не вместит
    const font = Math.max(18, Math.min(46, arc * 0.5));
    const maxChars = Math.max(5, Math.floor((r * 0.7) / (font * 0.56)));
    let label = labels[i];
    if (label.length > maxChars) label = `${label.slice(0, maxChars - 1)}…`;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a0 + seg / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${font}px Manrope, sans-serif`;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(4, font * 0.2);
    ctx.strokeStyle = "rgba(9,12,22,0.6)";
    ctx.strokeText(label, r - 26, 0);
    ctx.fillStyle = highlight >= 0 && i !== highlight ? "rgba(255,255,255,0.55)" : "#fff";
    ctx.fillText(label, r - 26, 0);
    ctx.restore();
  }
  // Ступица посередине закрывает сходящиеся вершины сегментов.
  ctx.beginPath();
  ctx.arc(c, c, 46, 0, Math.PI * 2);
  ctx.fillStyle = "#1e1c26";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(242,169,59,0.7)";
  ctx.stroke();
}

/**
 * Крутит canvas так, чтобы под стрелкой (сверху) остался сегмент winner из n. Угол внутри сегмента случайный,
 * но не у самого края. onCross(i) зовётся, когда стрелка переходит на новый сегмент. Возвращает { promise, cancel }.
 */
export function spinTo(canvas, n, winner, { onCross, startDeg = 0 } = {}) {
  const segDeg = 360 / n;
  const jitter = (Math.random() - 0.5) * segDeg * 0.6;
  const finalMod = (((360 - (winner + 0.5) * segDeg - jitter) % 360) + 360) % 360;
  const reduced = prefersReducedMotion();
  const duration = reduced ? 500 : SPIN_MS;
  const startMod = ((startDeg % 360) + 360) % 360;
  const toTarget = (((finalMod - startMod) % 360) + 360) % 360;
  const endDeg = startDeg + (reduced ? 1 : EXTRA_TURNS) * 360 + toTarget;
  const total = endDeg - startDeg;
  const t0 = performance.now();
  let raf = 0;
  let lastIdx = -1;
  let done = null;

  const promise = new Promise((resolve) => {
    done = resolve;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const deg = startDeg + total * quartic(t);
      canvas.style.transform = `rotate(${deg}deg)`;
      const idx = Math.floor((((360 - (((deg % 360) + 360) % 360)) % 360) / segDeg)) % n;
      if (idx !== lastIdx) {
        if (lastIdx !== -1) onCross?.(idx);
        lastIdx = idx;
      }
      if (t < 1) raf = requestAnimationFrame(step);
      else resolve(endDeg);
    };
    raf = requestAnimationFrame(step);
  });
  return {
    promise,
    cancel() {
      cancelAnimationFrame(raf);
      done?.(null);
    },
  };
}
