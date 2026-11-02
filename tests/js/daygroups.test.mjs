import assert from "node:assert/strict";
import test from "node:test";

import { orderDays } from "../../app/web/static/js/daygroups.js";

const DAYS = ["2026-10-02", "2026-10-30", "2026-11-05", "2026-11-20", "2026-10-15"];

test("сегодняшний день идёт первым, затем будущие, затем прошедшие", () => {
  assert.deepEqual(orderDays(DAYS, "2026-11-05"), ["2026-11-05", "2026-11-20", "2026-10-02", "2026-10-15", "2026-10-30"]);
});

test("если сегодня релизов нет, первым идёт ближайший следующий день", () => {
  assert.deepEqual(orderDays(DAYS, "2026-11-01").slice(0, 2), ["2026-11-05", "2026-11-20"]);
});

test("сезон целиком в прошлом или в будущем остаётся по порядку дат", () => {
  assert.deepEqual(orderDays(DAYS, "2027-01-01"), [...DAYS].sort());
  assert.deepEqual(orderDays(DAYS, "2026-01-01"), [...DAYS].sort());
});
