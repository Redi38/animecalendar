import assert from "node:assert/strict";
import test from "node:test";

import { seasonIndex, seasonStep } from "../../app/web/static/js/seasons.js";

const SLUGS = ["winter", "spring", "summer", "fall"];

test("шаг вперёд и назад внутри года", () => {
  assert.deepEqual(seasonStep(SLUGS, 2026, "spring", 1), { year: 2026, slug: "summer" });
  assert.deepEqual(seasonStep(SLUGS, 2026, "spring", -1), { year: 2026, slug: "winter" });
});

test("переход через границу года в обе стороны", () => {
  assert.deepEqual(seasonStep(SLUGS, 2026, "fall", 1), { year: 2027, slug: "winter" });
  assert.deepEqual(seasonStep(SLUGS, 2026, "winter", -1), { year: 2025, slug: "fall" });
});

test("номер сезона растёт на единицу за шаг", () => {
  assert.equal(seasonIndex(SLUGS, 2026, "winter") + 1, seasonIndex(SLUGS, 2026, "spring"));
  assert.equal(seasonIndex(SLUGS, 2026, "fall") + 1, seasonIndex(SLUGS, 2027, "winter"));
});
