import assert from "node:assert/strict";
import test from "node:test";

import { formatTitles, plural } from "../../app/web/static/js/util.js";

test("formatTitles склоняет по-русски", () => {
  assert.equal(formatTitles(1), "1 тайтл");
  assert.equal(formatTitles(3), "3 тайтла");
  assert.equal(formatTitles(5), "5 тайтлов");
  assert.equal(formatTitles(11), "11 тайтлов");
  assert.equal(formatTitles(21), "21 тайтл");
});

test("plural выбирает форму", () => {
  assert.equal(plural(2, ["серия", "серии", "серий"]), "серии");
});
