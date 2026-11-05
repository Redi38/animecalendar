import assert from "node:assert/strict";
import test from "node:test";

const { arrangeByFranchise, byStart, describeGroup, startKey } = await import("../../app/web/static/js/groups.js");

const item = (id, title, start, format_ru = "ТВ-сериал") => ({ id, title, start, format_ru });

test("startKey: неточные даты идут в конец периода, неизвестные — в самый конец", () => {
  assert.equal(startKey(item(1, "a", "2026-10-06")), "2026-10-06");
  assert.equal(startKey(item(1, "a", "2026-10")), "2026-10-32");
  assert.equal(startKey(item(1, "a", "2026")), "2026-13-32");
  assert.equal(startKey(item(1, "a", null)), "9999-99-99");
  assert.ok(startKey(item(1, "a", "2026")) > startKey(item(1, "a", "2026-12-31")));
});

test("byStart сортирует по дате премьеры, при равенстве — по id", () => {
  const list = [item(3, "c", "2024-01-01"), item(2, "b", "2022-01-01"), item(1, "a", "2022-01-01"), item(4, "d", null)];
  assert.deepEqual(list.sort(byStart).map((i) => i.id), [1, 2, 3, 4]);
});

test("arrangeByFranchise собирает группу из двух и более просмотренных тайтлов", () => {
  const items = [
    item(10, "Наруто 2", "2007-02-15"),
    item(11, "Берсерк", "1997-10-08"),
    item(12, "Наруто", "2002-10-03"),
    item(13, "Наруто: Фильм", "2004-08-21", "Фильм"),
  ];
  const groups = [{ id: 12, title: "Наруто", cover: "c.jpg", color: "#fff", total: 9, seeds: [10, 12, 13] }];
  const entries = arrangeByFranchise(items, groups);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.title]),
    [
      ["group", "Наруто"], // группы идут выше одиночных тайтлов, даже если названия «позже» по алфавиту
      ["single", "Берсерк"],
    ],
  );
  assert.deepEqual(entries[0].items.map((i) => i.id), [12, 13, 10]); // по дате премьеры
  assert.equal(entries[0].total, 9);
});

test("группа из одного тайтла остаётся обычной карточкой", () => {
  const items = [item(1, "Один", "2020-01-01"), item(2, "Два", "2021-01-01")];
  const entries = arrangeByFranchise(items, [{ id: 1, title: "Один", total: 3, seeds: [1, 99] }]);
  assert.deepEqual(entries.map((e) => e.kind), ["single", "single"]);
});

test("тайтл не попадает в две группы сразу", () => {
  const items = [item(1, "а", "2020-01-01"), item(2, "б", "2021-01-01"), item(3, "в", "2022-01-01")];
  const groups = [
    { id: 1, title: "А", total: 2, seeds: [1, 2] },
    { id: 2, title: "Б", total: 2, seeds: [2, 3] },
  ];
  const entries = arrangeByFranchise(items, groups);
  assert.equal(entries.filter((e) => e.kind === "group").length, 1);
  assert.equal(entries.reduce((n, e) => n + (e.kind === "group" ? e.items.length : 1), 0), 3);
});

test("без групп все тайтлы — карточки по алфавиту; пустой список не ломает", () => {
  const items = [item(2, "Яблоко", null), item(1, "Арбуз", null)];
  assert.deepEqual(arrangeByFranchise(items, []).map((e) => e.title), ["Арбуз", "Яблоко"]);
  assert.deepEqual(arrangeByFranchise(items, undefined).map((e) => e.title), ["Арбуз", "Яблоко"]);
  assert.deepEqual(arrangeByFranchise([], []), []);
});

test("describeGroup перечисляет форматы внутри группы", () => {
  const items = [item(1, "a", null), item(2, "b", null), item(3, "c", null, "Фильм")];
  assert.equal(describeGroup(items), "3 тайтла · ТВ-сериал ×2, Фильм");
  assert.equal(describeGroup([{ id: 1, title: "x" }]), "1 тайтл");
});

test("все группы выше одиночных тайтлов, внутри каждой части — по алфавиту", () => {
  const items = [
    item(1, "Арбуз", "2020-01-01"),
    item(2, "Яблоко 1", "2020-01-01"),
    item(3, "Яблоко 2", "2021-01-01"),
    item(4, "Банан 1", "2020-01-01"),
    item(5, "Банан 2", "2021-01-01"),
  ];
  const groups = [
    { id: 2, title: "Яблоко", total: 2, seeds: [2, 3] },
    { id: 4, title: "Банан", total: 2, seeds: [4, 5] },
  ];
  assert.deepEqual(arrangeByFranchise(items, groups).map((e) => `${e.kind}:${e.title}`), ["group:Банан", "group:Яблоко", "single:Арбуз"]);
});
