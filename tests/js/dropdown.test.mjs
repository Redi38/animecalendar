import assert from "node:assert/strict";
import test from "node:test";

import { nextIndex } from "../../app/web/static/js/ui/dropdown.js";

test("стрелки двигают по списку без зацикливания", () => {
  assert.equal(nextIndex("ArrowDown", 0, 3), 1);
  assert.equal(nextIndex("ArrowDown", 2, 3), 2);
  assert.equal(nextIndex("ArrowUp", 1, 3), 0);
  assert.equal(nextIndex("ArrowUp", 0, 3), 0);
});

test("Home и End прыгают к краям, прочие клавиши не меняют пункт", () => {
  assert.equal(nextIndex("Home", 2, 3), 0);
  assert.equal(nextIndex("End", 0, 3), 2);
  assert.equal(nextIndex("a", 1, 3), 1);
});
