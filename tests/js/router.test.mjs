import assert from "node:assert/strict";
import test from "node:test";

import { navName, parseRoute } from "../../app/web/static/js/router.js";

test("разбирает адреса страниц", () => {
  assert.deepEqual(parseRoute("#/season/2026/fall"), { name: "season", year: 2026, slug: "fall" });
  assert.deepEqual(parseRoute("#/title/42"), { name: "title", id: 42 });
  assert.deepEqual(parseRoute("#/tba"), { name: "tba" });
  assert.deepEqual(parseRoute("#/watched"), { name: "watched" });
  assert.deepEqual(parseRoute("#/upcoming"), { name: "upcoming" });
  assert.deepEqual(parseRoute("#/ignored"), { name: "ignored" });
});

test("поиск: запрос декодируется и обрезается до 100 символов", () => {
  assert.deepEqual(parseRoute("#/search/%D0%B0%D0%BD%D0%B8%D0%BC%D0%B5"), { name: "search", q: "аниме" });
  assert.equal(parseRoute("#/search/" + "a".repeat(300)).q.length, 100);
});

test("всё неизвестное или повреждённое ведёт на главную", () => {
  for (const hash of ["", "#", "#/", "#/nonsense", "#/season/2026/autumn", "#/title/abc", "#/search/%E0%A4%A", "#/season/26/fall"]) {
    assert.deepEqual(parseRoute(hash), { name: "home" }, hash);
  }
});

test("какой пункт меню подсвечивается", () => {
  assert.equal(navName({ name: "season" }), "season");
  assert.equal(navName({ name: "tba" }), "season");
  assert.equal(navName({ name: "ignored" }), "upcoming");
  assert.equal(navName({ name: "watched" }), "watched");
  assert.equal(navName({ name: "search" }), "search");
});

test("страница студии: адрес разбирается, пункта меню у неё нет", () => {
  assert.deepEqual(parseRoute("#/studio/7001"), { name: "studio", id: 7001 });
  assert.deepEqual(parseRoute("#/studio/abc"), { name: "home" });
  assert.deepEqual(parseRoute("#/studio/"), { name: "home" });
  assert.equal(navName({ name: "studio" }), "studio");
});
