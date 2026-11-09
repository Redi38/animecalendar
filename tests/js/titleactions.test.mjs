import assert from "node:assert/strict";
import test from "node:test";

const { createTitleActions } = await import("../../app/web/static/js/titleactions.js");

function setup({ ignoreOk = true, restoreOk = true, replaceResult = "replaced", picked = { id: 7, title: "Правильный" } } = {}) {
  const log = { toasts: [], closed: 0, went: [], store: [] };
  const store = {
    importedAs: () => "запрос из файла",
    ignore: (id) => (log.store.push(["ignore", id]), ignoreOk),
    restore: (id) => (log.store.push(["restore", id]), restoreOk),
    replace: (from, to) => (log.store.push(["replace", from, to]), replaceResult),
  };
  const asked = [];
  const actions = createTitleActions({
    store,
    toast: (...args) => log.toasts.push(args),
    pickTitle: async (arg) => (asked.push(arg), picked),
    closeToBase: () => log.closed++,
    goTo: (hash) => log.went.push(hash),
  });
  return { actions, log, asked };
}
const d = { id: 3, title: "Ошибочный" };

test("игнорирование: тайтл скрыт, показано уведомление с подсказкой, карточка закрыта", () => {
  const t = setup();
  t.actions.ignore(d);
  assert.deepEqual(t.log.store, [["ignore", 3]]);
  assert.deepEqual(t.log.toasts, [["«Ошибочный» скрыт из анонсов.", "info", "Вернуть его можно на странице «Скрытые тайтлы»."]]);
  assert.equal(t.log.closed, 1);
});

test("игнорирование: список скрытых полон — ошибка, карточка остаётся открытой", () => {
  const t = setup({ ignoreOk: false });
  t.actions.ignore(d);
  assert.equal(t.log.toasts[0][1], "error");
  assert.equal(t.log.closed, 0);
});

test("возврат из скрытых: уведомление и закрытие; если тайтла там не было — тишина", () => {
  const t = setup();
  t.actions.restore(d);
  assert.deepEqual(t.log.toasts, [["«Ошибочный» снова в «Моих анонсах»", "accent"]]);
  assert.equal(t.log.closed, 1);
  const none = setup({ restoreOk: false });
  none.actions.restore(d);
  assert.deepEqual([none.log.toasts.length, none.log.closed], [0, 0]);
});

test("переименование: окно открывается с запросом из файла, потом переход на выбранный тайтл", async () => {
  const t = setup();
  await t.actions.rename(d);
  assert.deepEqual(t.asked, [{ current: d, query: "запрос из файла" }]);
  assert.deepEqual(t.log.store, [["replace", 3, 7]]);
  assert.deepEqual(t.log.toasts, [["Тайтл переименован: «Правильный»"]]);
  assert.deepEqual(t.log.went, ["#/title/7"]);
});

test("переименование: тайтл уже был в списке — другое сообщение; отмена и тот же тайтл — ничего", async () => {
  const merged = setup({ replaceResult: "merged" });
  await merged.actions.rename(d);
  assert.match(merged.log.toasts[0][0], /уже был в списке/);
  const same = setup({ replaceResult: "unchanged" });
  await same.actions.rename(d);
  assert.deepEqual([same.log.toasts.length, same.log.went.length], [0, 0]);
  const cancelled = setup({ picked: null });
  await cancelled.actions.rename(d);
  assert.deepEqual(cancelled.log.store, []);
});

test("какие действия у карточки под какой страницей", () => {
  const { actions } = setup();
  assert.deepEqual(Object.keys(actions.forPage("#/watched")), ["onRename"]);
  assert.deepEqual(Object.keys(actions.forPage("#/upcoming")), ["onIgnore"]);
  assert.deepEqual(Object.keys(actions.forPage("#/ignored")), ["onRestore"]);
  assert.deepEqual(actions.forPage("#/season/2026/fall"), {});
  assert.deepEqual(actions.forPage(null), {});
  assert.equal(actions.forPage("#/watched").onRename, actions.rename);
});
