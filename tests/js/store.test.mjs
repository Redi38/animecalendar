import assert from "node:assert/strict";
import test from "node:test";

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => void memory.set(k, String(v)),
};
const { store } = await import("../../app/web/static/js/store.js");

test("replace подменяет тайтл на том же месте списка", () => {
  store.clear();
  store.addImported([
    { id: 1, title: "один" },
    { id: 2, title: "два" },
    { id: 3, title: "три" },
  ]);
  assert.equal(store.replace(2, 20), "replaced");
  assert.deepEqual(store.ids(), [1, 20, 3]);
  assert.equal(store.importedAs(20), "два"); // исходное название из файла сохраняется
  assert.equal(store.importedAs(2), null);
});

test("replace на тайтл, который уже в списке, просто убирает ошибочный", () => {
  store.clear();
  store.addImported([
    { id: 1, title: "один" },
    { id: 2, title: "два" },
  ]);
  assert.equal(store.replace(2, 1), "merged");
  assert.deepEqual(store.ids(), [1]);
  assert.equal(store.importedAs(2), null);
});

test("replace ничего не делает для чужих или одинаковых id", () => {
  store.clear();
  store.addMany([1, 2]);
  assert.equal(store.replace(9, 5), "unchanged");
  assert.equal(store.replace(1, 1), "unchanged");
  assert.equal(store.replace(1, -4), "unchanged");
  assert.deepEqual(store.ids(), [1, 2]);
});

test("исходные названия переживают перезапись в localStorage и чистятся вместе с тайтлом", () => {
  store.clear();
  store.addImported([{ id: 7, title: "семь" }]);
  assert.deepEqual(JSON.parse(memory.get("anime_calendar_v1")).imported, { 7: "семь" });
  store.toggle(7);
  assert.equal(store.importedAs(7), null);
  assert.deepEqual(JSON.parse(memory.get("anime_calendar_v1")).imported, {});
});
