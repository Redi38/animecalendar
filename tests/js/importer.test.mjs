import assert from "node:assert/strict";
import test from "node:test";

const { parseListFile, titlesFromFile } = await import("../../app/web/static/js/importer.js");

test("названия: строки и объекты, пустые записи пропускаются и считаются", () => {
  assert.deepEqual(titlesFromFile(["  A ", { title: "B" }, "", { title: "  " }, null, 5]), { titles: ["A", "B"], skipped: 4 });
});

test("названий нет — null, чтобы файл разобрали как список id", () => {
  assert.equal(titlesFromFile([]), null);
  assert.equal(titlesFromFile([1, 2, 3]), null);
  assert.equal(titlesFromFile({ watched: [1] }), null);
});

test("файл с id: массив или {watched: [...]}", () => {
  assert.deepEqual(parseListFile([1, 2]), { kind: "ids", ids: [1, 2] });
  assert.deepEqual(parseListFile({ watched: [3] }), { kind: "ids", ids: [3] });
});

test("файл с названиями", () => {
  assert.deepEqual(parseListFile(["Naruto", " "]), { kind: "titles", titles: ["Naruto"], skipped: 1 });
});

test("чужой формат — ошибка", () => {
  for (const bad of [null, 5, "text", {}, { watched: "1" }]) assert.throws(() => parseListFile(bad), /bad format/, JSON.stringify(bad));
});
