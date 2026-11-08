import assert from "node:assert/strict";
import test, { mock } from "node:test";

const { createRelated, MAX_RETRIES, RETRY_MS } = await import("../../app/web/static/js/related.js");

function setup(responses) {
  const list = { ids: [3, 1] };
  const calls = [];
  const updates = [];
  const api = {
    related: async (ids) => {
      calls.push([...ids]);
      const r = typeof responses === "function" ? responses(calls.length) : responses;
      return structuredClone(r);
    },
  };
  const related = createRelated({ store: { ids: () => [...list.ids] }, api, onUpdate: () => updates.push(1) });
  return { related, list, calls, updates };
}

test("пустой список: запроса нет, данные пустые", async () => {
  const t = setup({ items: [] });
  t.list.ids = [];
  const data = await t.related.load();
  assert.deepEqual(data, { items: [], degraded: false });
  assert.equal(t.calls.length, 0);
  assert.equal(t.related.ids.size, 0);
});

test("значок и отметки «★» берут и анонсы, и уже вышедшие связанные тайтлы", async () => {
  const t = setup({ items: [{ id: 10 }], linked: [11, 12] });
  await t.related.load();
  assert.deepEqual([...t.related.ids].sort(), [10, 11, 12]);
  assert.equal(t.related.data.items.length, 1);
});

test("одно состояние списка — один запрос, в том числе параллельные", async () => {
  const t = setup({ items: [] });
  await Promise.all([t.related.load(), t.related.load()]);
  await t.related.load();
  assert.equal(t.calls.length, 1);
  assert.equal(t.related.listKey(), "1,3");
});

test("список изменился во время запроса: данные запрашиваются заново", async () => {
  let n = 0;
  const t = setup(() => {
    if (++n === 1) t.list.ids = [1, 2, 3];
    return { items: [{ id: n }] };
  });
  const data = await t.related.load();
  assert.equal(t.calls.length, 2);
  assert.deepEqual(t.calls[1], [1, 2, 3]);
  assert.equal(data.items[0].id, 2);
});

test("неполный ответ повторяется по таймеру, но не бесконечно", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = setup({ items: [], incomplete: true });
    await t.related.load();
    for (let i = 0; i < MAX_RETRIES + 5; i++) {
      mock.timers.tick(RETRY_MS);
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(t.calls.length, 1 + MAX_RETRIES);
    assert.equal(t.updates.length, MAX_RETRIES);
  } finally {
    mock.timers.reset();
  }
});

test("повтор не идёт, если список уже другой", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const t = setup({ items: [], incomplete: true });
    await t.related.load();
    t.list.ids = [5];
    mock.timers.tick(RETRY_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(t.calls.length, 1);
  } finally {
    mock.timers.reset();
  }
});
