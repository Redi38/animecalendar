import assert from "node:assert/strict";
import test from "node:test";

import { createLoader } from "../../app/web/static/js/loader.js";

const never = () => assert.fail("не должно вызываться");

test("отдаёт данные в onData и возвращает true", async () => {
  const loader = createLoader(() => true);
  let got = null;
  assert.equal(await loader.run(async () => 42, (d) => (got = d), never), true);
  assert.equal(got, 42);
});

test("запросу передаётся signal загрузчика", async () => {
  const loader = createLoader(() => true);
  let seen = null;
  await loader.run(async (signal) => (seen = signal), () => {}, never);
  assert.equal(seen, loader.signal);
});

test("ответ для уже закрытой страницы пропускается", async () => {
  let current = true;
  const loader = createLoader(() => current);
  const result = await loader.run(
    async () => {
      current = false;
      return 1;
    },
    never,
    never,
  );
  assert.equal(result, false);
});

test("abort() отменяет запрос без вызова onError", async () => {
  const loader = createLoader(() => true);
  const result = await loader.run(
    (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        loader.abort();
      }),
    never,
    never,
  );
  assert.equal(result, false);
});

test("ошибка запроса и ошибка в onData приходят в onError", async () => {
  const loader = createLoader(() => true);
  const errors = [];
  assert.equal(await loader.run(async () => Promise.reject(new Error("сеть")), never, (e) => errors.push(e.message)), false);
  assert.equal(
    await loader.run(
      async () => 1,
      () => {
        throw new Error("отрисовка");
      },
      (e) => errors.push(e.message),
    ),
    false,
  );
  assert.deepEqual(errors, ["сеть", "отрисовка"]);
});

test("ошибка устаревшей страницы не показывается", async () => {
  let current = true;
  const loader = createLoader(() => current);
  await loader.run(
    async () => {
      current = false;
      throw new Error("поздно");
    },
    never,
    never,
  );
});
