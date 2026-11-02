import assert from "node:assert/strict";
import test from "node:test";

import { groupRelations } from "../../app/web/static/js/relations.js";

const rel = (id, format) => ({ id, format });

test("ТВ, фильмы и спешлы — отдельные группы в этом порядке", () => {
  const groups = groupRelations([rel(1, "SPECIAL"), rel(2, "MOVIE"), rel(3, "TV"), rel(4, "TV_SHORT")]);
  assert.deepEqual(
    groups.map((g) => [g.key, g.items.map((r) => r.id)]),
    [["tv", [3, 4]], ["movie", [2]], ["special", [1]]],
  );
});

test("OVA/ONA и неизвестные форматы идут после, пустые группы не возвращаются", () => {
  const groups = groupRelations([rel(1, null), rel(2, "ONA"), rel(3, "MUSIC"), rel(4, "OVA")]);
  assert.deepEqual(
    groups.map((g) => [g.key, g.items.map((r) => r.id)]),
    [["ova", [2, 4]], ["other", [1, 3]]],
  );
  assert.deepEqual(groupRelations([]), []);
});

test("порядок внутри группы сохраняется", () => {
  const groups = groupRelations([rel(9, "TV"), rel(2, "TV"), rel(5, "TV")]);
  assert.deepEqual(groups[0].items.map((r) => r.id), [9, 2, 5]);
});
