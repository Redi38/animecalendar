import assert from "node:assert/strict";
import test from "node:test";

const { cleanIds, mergeSets, mergeState, normalize, sameState, toFile, LIST_LIMIT } = await import("../../app/web/static/js/syncmerge.js");

const state = (watched, extra = {}) => ({ watched, ignored: [], seen: null, imported: {}, ...extra });

test("без общей истории копии объединяются", () => {
  assert.deepEqual(mergeSets([1, 2], [2, 3], null).ids, [2, 3, 1]); // сначала облако, потом добавленное здесь
  assert.deepEqual(mergeSets([], [5, 6], undefined).ids, [5, 6]);
  assert.deepEqual(mergeSets([5], [], null).ids, [5]);
});

test("убранное на одном устройстве убирается и на другом", () => {
  // было [1,2,3]; в облаке убрали 2; здесь ничего не менялось
  assert.deepEqual(mergeSets([1, 2, 3], [1, 3], [1, 2, 3]).ids, [1, 3]);
  // здесь убрали 3; в облаке ничего не менялось
  assert.deepEqual(mergeSets([1, 2], [1, 2, 3], [1, 2, 3]).ids, [1, 2]);
});

test("добавленное в обеих копиях сохраняется, убранное не воскресает", () => {
  // здесь добавили 4 и убрали 1; в облаке добавили 5
  assert.deepEqual(mergeSets([2, 3, 4], [1, 2, 3, 5], [1, 2, 3]).ids, [2, 3, 5, 4]);
});

test("тайтл, убранный в облаке и заново добавленный здесь, не теряется только если его не было в base", () => {
  assert.deepEqual(mergeSets([7], [], [1]).ids, [7]);
  assert.deepEqual(mergeSets([1], [], [1]).ids, []); // был общим, убрали в облаке
});

test("лимит обрезает список и сообщает об этом", () => {
  const big = Array.from({ length: 6 }, (_, i) => i + 1);
  const res = mergeSets(big, [], null, 4);
  assert.deepEqual(res.ids, [1, 2, 3, 4]);
  assert.equal(res.truncated, true);
  assert.equal(mergeSets([1], [], null, 4).truncated, false);
});

test("cleanIds отбрасывает мусор, повторы и ограничивает длину", () => {
  assert.deepEqual(cleanIds([1, "2", 2.5, -3, 0, null, 1, 7, {}, 8], 3), [1, 7, 8]);
  assert.deepEqual(cleanIds("nope"), []);
  assert.deepEqual(cleanIds(undefined), []);
});

test("normalize принимает только наши данные и чистит их", () => {
  assert.equal(normalize(null), null);
  assert.equal(normalize([1, 2]), null);
  assert.equal(normalize("x"), null);
  const n = normalize({
    watched: [3, "x", 3, 4],
    ignored: [9, -1],
    seen: [1, "a"],
    imported: { 3: "Название", 4: "", 99: "чужой", 5: 123 },
  });
  assert.deepEqual(n, { watched: [3, 4], ignored: [9], seen: [1], imported: { 3: "Название" } });
  assert.equal(normalize({ watched: [1] }).seen, null);
  assert.equal(normalize({ watched: Array.from({ length: LIST_LIMIT + 50 }, (_, i) => i + 1) }).watched.length, LIST_LIMIT);
});

test("mergeState: скрытые и «Новое» сливаются отдельно, названия импорта берутся у того, у кого есть", () => {
  const local = state([1, 2], { ignored: [10], seen: [5], imported: { 1: "из файла" } });
  const remote = state([2, 3], { ignored: [11], seen: [6], imported: { 2: "облако", 3: "облако 3" } });
  const { state: merged, truncated } = mergeState(local, remote, null);
  assert.deepEqual(merged.watched, [2, 3, 1]);
  assert.deepEqual(merged.ignored.sort(), [10, 11]);
  assert.deepEqual(merged.seen.sort(), [5, 6]);
  assert.deepEqual(merged.imported, { 1: "из файла", 2: "облако", 3: "облако 3" });
  assert.equal(truncated, false);
});

test("mergeState: пустое облако не стирает список, «Новое» остаётся null, пока его нет нигде", () => {
  const { state: merged } = mergeState(state([1, 2]), null, null);
  assert.deepEqual(merged.watched, [1, 2]);
  assert.equal(merged.seen, null);
});

test("mergeState: названия импорта не остаются у убранных тайтлов", () => {
  const local = state([1], { imported: { 1: "a" } });
  const remote = state([], {});
  const { state: merged } = mergeState(local, remote, { watched: [1], ignored: [] });
  assert.deepEqual(merged.watched, []);
  assert.deepEqual(merged.imported, {});
});

test("sameState: порядок важен у просмотренного и не важен у остального", () => {
  assert.equal(sameState(state([1, 2]), state([1, 2])), true);
  assert.equal(sameState(state([1, 2]), state([2, 1])), false);
  assert.equal(sameState(state([1], { ignored: [1, 2] }), state([1], { ignored: [2, 1] })), true);
  assert.equal(sameState(state([1], { seen: null }), state([1], { seen: [] })), false);
  assert.equal(sameState(state([1], { imported: { 1: "a" } }), state([1], { imported: { 1: "b" } })), false);
});

test("toFile добавляет версию и время", () => {
  const f = toFile(state([1]), new Date("2026-11-05T10:00:00Z"));
  assert.equal(f.version, 1);
  assert.equal(f.updated, "2026-11-05T10:00:00.000Z");
  assert.deepEqual(f.watched, [1]);
});
