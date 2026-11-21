// Настройки рулетки, как в Film Roulette: скорость вращения, неон и конфетти. Чистая логика без DOM; хранится в localStorage.

import { readJson, writeJson } from "./storage.js";

export const FX_KEY = "anime_wheel_fx_v1";
export const SPEED_MIN = 1; // секунд на одно вращение
export const SPEED_MAX = 60;
export const SPEED_DEFAULT = 5.2; // столько колесо крутилось до появления настройки
export const SPEED_STEP = 0.1;

/** Скорость в секундах: число в пределах [SPEED_MIN, SPEED_MAX] с точностью до 0.1. Не число -> fallback. */
export function clampSpeed(value, fallback = SPEED_DEFAULT) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, value)) * 10) / 10;
}

/** «5.2», «10» — без лишнего «.0». */
export function formatSpeed(value) {
  return String(Math.round(value * 10) / 10);
}

/** Настройки из localStorage; битые или чужие данные заменяются значениями по умолчанию. */
export function loadFx() {
  const data = readJson(FX_KEY);
  const ok = data && typeof data === "object";
  return {
    speed: clampSpeed(ok ? data.speed : undefined),
    neon: ok ? data.neon === true : false,
    confetti: ok && typeof data.confetti === "boolean" ? data.confetti : true,
  };
}

export function saveFx(fx) {
  writeJson(FX_KEY, { speed: fx.speed, neon: fx.neon, confetti: fx.confetti });
}
