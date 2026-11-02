import assert from "node:assert/strict";
import test from "node:test";

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => void memory.set(k, String(v)),
};
const { readJson, storageGet, storageSet, writeJson } = await import("../../app/web/static/js/storage.js");

test("JSON туда и обратно", () => {
  assert.equal(writeJson("k", { a: [1, 2] }), true);
  assert.deepEqual(readJson("k"), { a: [1, 2] });
});

test("нет записи или она повреждена — fallback", () => {
  assert.equal(readJson("missing", 7), 7);
  memory.set("bad", "{oops");
  assert.deepEqual(readJson("bad", {}), {});
});

test("недоступное хранилище не бросает исключений", () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  assert.equal(storageGet("k"), null);
  assert.equal(storageSet("k", "v"), false);
  globalThis.localStorage = saved;
});
