import assert from "node:assert/strict";
import test from "node:test";

import { nextTheme, resolveTheme } from "../../app/web/static/js/theme.js";

test("сохранённый выбор важнее системной темы", () => {
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("light", false), "light");
});

test("без выбора берём системную тему; мусор в хранилище игнорируется", () => {
  assert.equal(resolveTheme(null, true), "light");
  assert.equal(resolveTheme(null, false), "dark");
  assert.equal(resolveTheme("purple", true), "light");
});

test("переключатель чередует темы", () => {
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "light");
});

// --- поведение переключателя на заглушках DOM ------------------------------------------

function setup({ systemLight, stored = null }) {
  const store = new Map(stored ? [["anime_calendar_theme", stored]] : []);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, v) };
  const listeners = [];
  const media = { matches: systemLight, addEventListener: (_, fn) => listeners.push(fn) };
  globalThis.window = { matchMedia: () => media };
  const meta = { content: "#14121a" };
  const root = { dataset: {} };
  globalThis.document = { documentElement: root, querySelector: () => meta };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => (root.dataset.theme === "light" ? " #f6f3ee" : " #14121a") });
  let click = () => {};
  const button = { attrs: {}, title: "", setAttribute(k, v) { this.attrs[k] = v; }, addEventListener: (_, fn) => (click = fn) };
  return { store, media, listeners, meta, root, button, click: () => click() };
}

const { initThemeToggle } = await import("../../app/web/static/js/theme.js");

test("без выбора берётся системная тема; клик переключает и запоминает", () => {
  const t = setup({ systemLight: true });
  initThemeToggle(t.button);
  assert.equal(t.root.dataset.theme, "light");
  assert.equal(t.meta.content, "#f6f3ee");
  assert.equal(t.button.attrs["aria-label"], "Включить тёмную тему");
  t.click();
  assert.equal(t.root.dataset.theme, "dark");
  assert.equal(t.store.get("anime_calendar_theme"), "dark");
  assert.equal(t.meta.content, "#14121a");
  assert.equal(t.button.attrs["aria-label"], "Включить светлую тему");
});

test("сохранённый выбор сильнее системной темы и не сбивается её сменой", () => {
  const t = setup({ systemLight: true, stored: "dark" });
  initThemeToggle(t.button);
  assert.equal(t.root.dataset.theme, "dark");
  t.media.matches = true;
  t.listeners.forEach((fn) => fn());
  assert.equal(t.root.dataset.theme, "dark");
});

test("без выбора смена системной темы подхватывается", () => {
  const t = setup({ systemLight: false });
  initThemeToggle(t.button);
  assert.equal(t.root.dataset.theme, "dark");
  t.media.matches = true;
  t.listeners.forEach((fn) => fn());
  assert.equal(t.root.dataset.theme, "light");
});
