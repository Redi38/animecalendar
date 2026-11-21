// Список для рулетки: тайтлы из каталога, которые пользователь добавил сам. Чистая логика без DOM; хранится в localStorage.

import { readJson, writeJson } from "./storage.js";

export const WHEEL_KEY = "anime_wheel_v1";
export const WHEEL_MAX_ITEMS = 100; // больше сегментов на колесе уже не прочитать
export const WHEEL_PLANNED_MAX = 150; // из «Хочу посмотреть» в колесо берём не больше стольких случайных тайтлов
export const MODES = { custom: "Свой список", planned: "Хочу посмотреть" };

const TITLE_MAX = 200;
const COVER_MAX = 600;

/** Запись списка из произвольных данных: { id, title, cover }. Всё лишнее отбрасывается; null, если это не тайтл. */
export function cleanItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) : "";
  if (!Number.isInteger(raw.id) || raw.id <= 0 || !title) return null;
  const cover = typeof raw.cover === "string" && /^https?:\/\//.test(raw.cover) && raw.cover.length <= COVER_MAX ? raw.cover : null;
  return { id: raw.id, title, cover };
}

/** Добавляет тайтл. status: "added", "duplicate" (уже в списке) или "full" (упёрлись в max). */
export function addItem(items, raw, max = WHEEL_MAX_ITEMS) {
  const item = cleanItem(raw);
  if (!item) return { items, status: "invalid" };
  if (items.some((x) => x.id === item.id)) return { items, status: "duplicate" };
  if (items.length >= max) return { items, status: "full" };
  return { items: [...items, item], status: "added" };
}

/** До limit случайных тайтлов; порядок в колесе тоже случайный. Исходный массив не меняется. */
export function sample(items, limit, pick) {
  const pool = [...items];
  const out = [];
  while (pool.length && out.length < limit) out.push(...pool.splice(pick(pool.length), 1));
  return out;
}

/** Состояние из localStorage; битые или чужие данные превращаются в пустой список. */
export function loadWheel() {
  const data = readJson(WHEEL_KEY);
  const items = [];
  const seen = new Set();
  if (data && Array.isArray(data.items)) {
    for (const raw of data.items) {
      const item = cleanItem(raw);
      if (item && !seen.has(item.id) && items.length < WHEEL_MAX_ITEMS) {
        seen.add(item.id);
        items.push(item);
      }
    }
  }
  return {
    items,
    mode: data?.mode === "planned" ? "planned" : "custom",
    mute: Boolean(data?.mute),
  };
}

export function saveWheel(state) {
  writeJson(WHEEL_KEY, { items: state.items, mode: state.mode, mute: state.mute });
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
