import assert from "node:assert/strict";
import test from "node:test";

const { createSync } = await import("../../app/web/static/js/sync.js");
const { DriveAuthError, SyncError } = await import("../../app/web/static/js/syncerrors.js");

// --- заглушки: общий «Google Диск» и два устройства -----------------------------------------------------------

function fakeCloud() {
  const cloud = { file: null, id: null, reads: 0, writes: 0, fail: null, authFailures: 0 };
  cloud.drive = (clock) => ({
    async read(token) {
      cloud.reads++;
      if (cloud.authFailures > 0) {
        cloud.authFailures--;
        throw new DriveAuthError();
      }
      if (cloud.fail) throw cloud.fail;
      if (!token) throw new DriveAuthError();
      return { id: cloud.id, data: cloud.file ? structuredClone(cloud.file) : null };
    },
    async write(token, id, data) {
      cloud.writes++;
      cloud.id = id || "file-1";
      cloud.file = structuredClone(data);
      return cloud.id;
    },
    async account() {
      return "me@example.com";
    },
  });
  return cloud;
}

function fakeStore(initial = {}) {
  const s = { watched: [], ignored: [], seen: null, imported: {}, ...initial };
  const listeners = new Set();
  return {
    state: s,
    snapshot: () => structuredClone(s),
    applyMerged(next) {
      Object.assign(s, structuredClone(next));
      for (const fn of listeners) fn("sync");
    },
    edit(patch) {
      Object.assign(s, patch);
      for (const fn of listeners) fn(undefined);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function device(cloud, initial, { loginFails = null, now = { t: 1_000_000 } } = {}) {
  const store = fakeStore(initial);
  const saved = { value: {} };
  const gis = {
    logins: 0,
    revoked: [],
    async request() {
      gis.logins++;
      if (loginFails) throw loginFails;
      return { access_token: `tok-${gis.logins}`, expires_in: 3600 };
    },
    async revoke(token) {
      gis.revoked.push(token);
    },
  };
  const sync = createSync({
    store,
    drive: cloud.drive(now),
    gis,
    readSettings: () => structuredClone(saved.value),
    writeSettings: (v) => (saved.value = structuredClone(v)),
    now: () => now.t,
    changeDelay: 5,
  });
  return { store, gis, sync, saved, now };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- сценарии -------------------------------------------------------------------------------------------------

test("первое подключение: пустое облако получает список этого устройства", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1, 2], ignored: [9] });
  assert.equal(a.sync.state().status, "off");
  assert.equal(await a.sync.connect(), true);
  assert.equal(a.sync.state().status, "idle");
  assert.equal(a.sync.state().email, "me@example.com");
  assert.deepEqual(cloud.file.watched, [1, 2]);
  assert.deepEqual(cloud.file.ignored, [9]);
  assert.equal(cloud.file.version, 1);
  assert.deepEqual(a.saved.value.base, { watched: [1, 2], ignored: [9] });
});

test("второе устройство объединяет свой список с облаком и отдаёт добавленное обратно", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1, 2] });
  await a.sync.connect();
  const b = device(cloud, { watched: [2, 3] });
  assert.equal(await b.sync.connect(), true);
  assert.deepEqual(b.store.state.watched, [1, 2, 3]); // сначала порядок облака, потом свои
  assert.equal(b.sync.state().result.applied, true);
  assert.deepEqual(cloud.file.watched, [1, 2, 3]);
  await a.sync.syncNow();
  assert.deepEqual(a.store.state.watched, [1, 2, 3]);
});

test("убранное на одном устройстве исчезает на другом, а не воскресает", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1, 2, 3] });
  const b = device(cloud, {});
  await a.sync.connect();
  await b.sync.connect();
  a.store.edit({ watched: [1, 3] });
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.deepEqual(b.store.state.watched, [1, 3]);
  b.store.edit({ watched: [3], ignored: [1] });
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.deepEqual(a.store.state.watched, [3]);
  assert.deepEqual(a.store.state.ignored, [1]);
});

test("правки на обоих устройствах между синхронизациями сходятся", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1, 2, 3] });
  const b = device(cloud, {});
  await a.sync.connect();
  await b.sync.connect();
  a.store.edit({ watched: [2, 3, 4] }); // убрали 1, добавили 4
  b.store.edit({ watched: [1, 2, 3, 5] }); // добавили 5
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.deepEqual([...a.store.state.watched].sort(), [2, 3, 4, 5]);
  assert.deepEqual(a.store.state.watched, b.store.state.watched);
  assert.deepEqual(cloud.file.watched, a.store.state.watched);
});

test("если всё уже совпадает, ничего не записывается", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1] });
  await a.sync.connect();
  const writes = cloud.writes;
  await a.sync.syncNow();
  assert.equal(cloud.writes, writes);
  assert.deepEqual(a.sync.state().result, { applied: false, uploaded: false, truncated: false });
});

test("повреждённый файл в облаке перезаписывается, список на устройстве не страдает", async () => {
  const cloud = fakeCloud();
  cloud.file = { watched: "ошибка" };
  cloud.id = "file-1";
  const a = device(cloud, { watched: [4] });
  await a.sync.connect();
  assert.deepEqual(a.store.state.watched, [4]);
  assert.deepEqual(cloud.file.watched, [4]);
});

test("правка списка запускает синхронизацию сама, а применение из облака — нет", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1] });
  a.sync.start(null);
  await a.sync.connect();
  const reads = cloud.reads;
  a.store.edit({ watched: [1, 2] });
  await sleep(40);
  assert.ok(cloud.reads > reads);
  assert.deepEqual(cloud.file.watched, [1, 2]);
  const after = cloud.reads;
  a.store.applyMerged({ watched: [1, 2], ignored: [], seen: null, imported: {} }); // источник «sync»
  await sleep(40);
  assert.equal(cloud.reads, after);
});

test("правки, пришедшие во время обмена, не теряются", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1] });
  a.sync.start(null);
  await a.sync.connect();
  const slow = a.sync.syncNow();
  a.store.edit({ watched: [1, 2] }); // во время обмена
  a.sync.syncNow(); // ещё один запрос: должен встать в очередь
  await slow;
  await sleep(60);
  assert.deepEqual(cloud.file.watched, [1, 2]);
});

test("токен истёк: без клика синхронизация ждёт входа, по клику входит и синхронизируется", async () => {
  const cloud = fakeCloud();
  const now = { t: 1_000_000 };
  const a = device(cloud, { watched: [1] }, { now });
  await a.sync.connect();
  now.t += 2 * 3600 * 1000;
  const reads = cloud.reads;
  a.sync.start(null);
  a.store.edit({ watched: [1, 2] });
  await sleep(40);
  assert.equal(a.sync.state().status, "needs-login");
  assert.equal(cloud.reads, reads); // к Диску не обращались
  assert.equal(await a.sync.syncNow(), true);
  assert.equal(a.gis.logins, 2);
  assert.equal(a.sync.state().status, "idle");
  assert.deepEqual(cloud.file.watched, [1, 2]);
});

test("Google отклонил токен посреди работы: фоновая синхронизация просит войти, ручная входит заново", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1] });
  await a.sync.connect();
  cloud.authFailures = 1;
  a.store.edit({ watched: [1, 2] });
  a.sync.start(null);
  await sleep(40);
  assert.equal(a.sync.state().status, "needs-login");
  assert.equal(a.saved.value.token, null);
  cloud.authFailures = 1;
  assert.equal(await a.sync.syncNow(), true); // токена нет — вход, затем обмен
  assert.deepEqual(cloud.file.watched, [1, 2]);
});

test("вход отменён: синхронизация не включается", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1] }, { loginFails: new SyncError("cancelled", "Вход в Google отменён.") });
  assert.equal(await a.sync.connect(), false);
  const s = a.sync.state();
  assert.equal(s.status, "off");
  assert.equal(s.message, "Вход в Google отменён.");
  assert.deepEqual(a.saved.value, {});
  assert.equal(cloud.reads, 0);
});

test("сетевая ошибка после входа: остаёмся подключёнными и показываем ошибку", async () => {
  const cloud = fakeCloud();
  cloud.fail = new SyncError("network", "Нет связи с Google. Попробуем позже.");
  const a = device(cloud, { watched: [1] });
  assert.equal(await a.sync.connect(), false);
  assert.equal(a.sync.state().status, "error");
  assert.equal(a.sync.state().message, "Нет связи с Google. Попробуем позже.");
  assert.equal(a.saved.value.enabled, true);
  cloud.fail = null;
  assert.equal(await a.sync.syncNow(), true);
  assert.equal(a.sync.state().status, "idle");
});

test("отключение отзывает токен и стирает настройки, список остаётся", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1] });
  await a.sync.connect();
  await a.sync.disconnect();
  assert.equal(a.sync.state().status, "off");
  assert.deepEqual(a.gis.revoked, ["tok-1"]);
  assert.deepEqual(a.saved.value, {});
  assert.deepEqual(a.store.state.watched, [1]);
  assert.equal(await a.sync.syncNow(), false); // выключено — ничего не делает
});

test("после перезагрузки страницы подключение и время последней синхронизации сохраняются", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1] });
  await a.sync.connect();
  const again = createSync({
    store: a.store,
    drive: cloud.drive(),
    gis: a.gis,
    readSettings: () => structuredClone(a.saved.value),
    writeSettings: () => {},
    now: () => a.now.t,
  });
  assert.equal(again.state().status, "idle");
  assert.equal(again.state().last, a.now.t);
  a.now.t += 3 * 3600 * 1000;
  const later = createSync({ store: a.store, drive: cloud.drive(), gis: a.gis, readSettings: () => structuredClone(a.saved.value), writeSettings: () => {}, now: () => a.now.t });
  assert.equal(later.state().status, "needs-login");
});

test("список больше лимита: лишнее отбрасывается и это видно в результате", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: Array.from({ length: 450 }, (_, i) => i + 1) });
  await a.sync.connect();
  const b = device(cloud, { watched: Array.from({ length: 200 }, (_, i) => i + 1000) });
  await b.sync.connect();
  assert.equal(b.store.state.watched.length, 500);
  assert.equal(b.sync.state().result.truncated, true);
});

test("подписчики получают состояние при каждой смене статуса", async () => {
  const cloud = fakeCloud();
  const a = device(cloud, { watched: [1] });
  const seen = [];
  a.sync.subscribe((s) => seen.push(s.status));
  await a.sync.connect();
  assert.deepEqual(seen.filter((x, i) => x !== seen[i - 1]), ["syncing", "idle"]); // повторы (пришло имя аккаунта) не считаем
});
