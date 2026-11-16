// Звук рулетки: короткие синтезированные «тики» при проходе сегментов и сигнал остановки (без звуковых файлов).

let ctx = null;
let lastTick = 0;
const TICK_GAP_MS = 28;

/** Звук можно включить только по действию пользователя, поэтому вызываем это при нажатии «Крутить». */
export function primeWheelSound() {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  } catch {
    /* без звука колесо работает так же */
  }
}

function blip(freq, ms, peak, delayMs, type) {
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + delayMs / 1000;
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + ms / 1000 + 0.03);
}

export function playTick() {
  const now = performance.now();
  if (now - lastTick < TICK_GAP_MS) return;
  lastTick = now;
  blip(1500, 20, 0.05, 0, "square");
}

export function playStop() {
  blip(150, 280, 0.2, 0, "sine");
  blip(1100, 240, 0.12, 0, "triangle");
  blip(750, 260, 0.08, 100, "triangle");
  navigator.vibrate?.([16, 45, 22]);
}
