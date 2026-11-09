import assert from "node:assert/strict";
import test from "node:test";

import { groupByYear, yearOf } from "../../app/web/static/js/studiogroups.js";

const item = (id, start, season_year = null) => ({ id, start, season_year });

test("год берётся из даты любой точности, иначе из сезона", () => {
  assert.equal(yearOf(item(1, "2026-10-06")), 2026);
  assert.equal(yearOf(item(1, "2026-10")), 2026);
  assert.equal(yearOf(item(1, "2026")), 2026);
  assert.equal(yearOf(item(1, null, 2025)), 2025);
  assert.equal(yearOf(item(1, null)), null);
  assert.equal(yearOf(item(1, "")), null);
});

test("годы идут от новых к старым, порядок внутри года сохраняется", () => {
  const groups = groupByYear([item(1, "2027-01-05"), item(2, "2026-10-06"), item(3, "2026-04-01"), item(4, "2020")]);
  assert.deepEqual(groups.map((g) => g.label), ["2027", "2026", "2020"]);
  assert.deepEqual(groups[1].items.map((i) => i.id), [2, 3]);
});

test("страницы подгружаются по очереди: старый год дополняется, порядок годов не ломается", () => {
  const first = [item(1, "2026-10-06"), item(2, "2025-04-01")];
  const second = [item(3, "2025-01-10"), item(4, "2024-07-01")];
  const groups = groupByYear([...first, ...second]);
  assert.deepEqual(groups.map((g) => g.label), ["2026", "2025", "2024"]);
  assert.deepEqual(groups[1].items.map((i) => i.id), [2, 3]);
});

test("анонсы без даты идут первыми отдельной группой", () => {
  const groups = groupByYear([item(1, "2026-10-06"), item(2, null), item(3, null, 2027)]);
  assert.deepEqual(groups.map((g) => g.label), ["Без даты", "2027", "2026"]);
  assert.deepEqual(groups[0].items.map((i) => i.id), [2]);
});

test("пустой список — нет групп", () => {
  assert.deepEqual(groupByYear([]), []);
});
