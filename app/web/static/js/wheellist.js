// Список для рулетки: что пользователь внёс сам. Чистая логика без DOM; хранится в localStorage этого браузера.

import { readJson, writeJson } from "./storage.js";

export const WHEEL_KEY = "anime_wheel_v1";
export const WHEEL_MAX_ITEMS = 100; // больше сегментов на колесе уже не прочитать
export const WHEEL_MAX_LEN = 80;

/** Название из ввода: лишние пробелы убраны, длина ограничена. Пустое -> "". */
export function cleanName(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, WHEEL_MAX_LEN);
}

/** Из вставленного текста (по строке на название) добавляет в список новые названия. Дубликаты без учёта регистра пропускаются. */
export function addNames(items, text, max = WHEEL_MAX_ITEMS) {
  const next = [...items];
  const seen = new Set(next.map((n) => n.toLowerCase()));
  let added = 0;
  let skipped = 0;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const name = cleanName(line);
    if (!name) continue;
    if (seen.has(name.toLowerCase())) {
      skipped++;
      continue;
    }
    if (next.length >= max) {
      skipped++;
      continue;
    }
    next.push(name);
    seen.add(name.toLowerCase());
    added++;
  }
  return { items: next, added, skipped };
}

/** Состояние из localStorage; битые или чужие данные превращаются в пустой список. */
export function loadWheel() {
  const data = readJson(WHEEL_KEY);
  const items = [];
  if (data && Array.isArray(data.items)) {
    for (const raw of data.items) {
      const name = typeof raw === "string" ? cleanName(raw) : "";
      if (name && items.length < WHEEL_MAX_ITEMS) items.push(name);
    }
  }
  return { items, removeWinner: Boolean(data?.removeWinner), mute: Boolean(data?.mute) };
}

export function saveWheel(state) {
  writeJson(WHEEL_KEY, { items: state.items, removeWinner: state.removeWinner, mute: state.mute });
}

/** Случайный индекс от 0 до n-1: crypto, когда есть, чтобы исход не зависел от Math.random. */
export function pickIndex(n) {
  if (n <= 1) return 0;
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const limit = Math.floor(0x100000000 / n) * n; // отсекаем хвост, чтобы не было перекоса к малым индексам
    const buf = new Uint32Array(1);
    do c.getRandomValues(buf);
    while (buf[0] >= limit);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}
