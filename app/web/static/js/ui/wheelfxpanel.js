// Скорость вращения и эффекты (неон, конфетти) в настройках рулетки. Меняет переданный объект fx и сохраняет его.

import { SPEED_MAX, SPEED_MIN, SPEED_STEP, clampSpeed, formatSpeed, saveFx } from "../wheelsettings.js";
import { h } from "../util.js";

/** Кнопка-переключатель настройки (как showcase-filter-btn в Film Roulette). onToggle получает новое значение. */
function fxToggle(label, pressed, onToggle) {
  const btn = h("button", { class: `wheel-fx-btn${pressed ? " active" : ""}`, type: "button", "aria-pressed": String(pressed) }, label);
  btn.addEventListener("click", () => {
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("active", on);
    btn.classList.remove("fx-toggle-pop");
    void btn.offsetWidth;
    btn.classList.add("fx-toggle-pop");
    onToggle(on);
  });
  btn.addEventListener("animationend", () => btn.classList.remove("fx-toggle-pop"));
  return btn;
}

/**
 * fx — { speed, neon, confetti }; holder — элемент колеса, на котором держится класс неона;
 * onConfettiOff — вызывается, когда конфетти выключили (чтобы убрать идущий залп).
 * Возвращает { fxRow, speedRow }.
 */
export function wheelFxPanel({ fx, holder, onConfettiOff }) {
  // Скорость вращения: число секунд, применяется со следующего запуска.
  function commitSpeed() {
    fx.speed = clampSpeed(parseFloat(speedInput.value.replace(",", ".")), fx.speed);
    speedInput.value = formatSpeed(fx.speed);
    saveFx(fx);
  }

  /** Неон включается плавно; при выключении гаснет под классом --neon-exit, который снимает конец анимации (длительность только в CSS). */
  function setNeon(on) {
    fx.neon = on;
    saveFx(fx);
    holder.classList.toggle("wheel-holder--neon", on);
    holder.classList.toggle("wheel-holder--classic", !on);
    holder.classList.toggle("wheel-holder--neon-exit", !on);
  }
  holder.addEventListener("animationend", (e) => {
    if (e.animationName === "wheel-neon-fade-out") holder.classList.remove("wheel-holder--neon-exit");
  });

  const speedInput = h("input", {
    class: "wheel-speed-input",
    type: "number",
    inputmode: "decimal",
    min: SPEED_MIN,
    max: SPEED_MAX,
    step: SPEED_STEP,
    value: formatSpeed(fx.speed),
    id: "wheel-speed",
    onchange: commitSpeed,
    onblur: commitSpeed,
    onkeydown: (e) => {
      if (e.key === "Enter") {
        commitSpeed();
        speedInput.blur();
      }
    },
  });
  const speedRow = h("div", { class: "wheel-speed" }, h("label", { for: "wheel-speed" }, "⏱ Скорость колеса"), speedInput, h("span", { class: "wheel-speed-unit" }, "сек"));
  const neonBtn = fxToggle("✨ Неон", fx.neon, setNeon);
  const confettiBtn = fxToggle("🎊 Конфетти", fx.confetti, (on) => {
    fx.confetti = on;
    saveFx(fx);
    if (!on) onConfettiOff();
  });
  const fxRow = h("div", { class: "wheel-fx-row" }, confettiBtn, neonBtn);

  return { fxRow, speedRow };
}
