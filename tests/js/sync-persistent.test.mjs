import assert from "node:assert/strict";
import test from "node:test";

const { createSync } = await import("../../app/web/static/js/sync.js");
const { createServerAuth } = await import("../../app/web/static/js/gserver.js");
const { DriveAuthError, SyncError } = await import("../../app/web/static/js/syncerrors.js");

// Постоянный вход: после одного окна Google новые токены выпускаются сервером по куке, без кликов.

function setup({ persistent = true, cookie = true } = {}) {
  const now = { t: 1_000_000 };
  const cloud = { file: null, id: null, validToken: null };
  const calls = { codes: 0, tokens: 0, disconnects: 0, revoked: [] };
  const state = { cookie: false, issued: 0 };
  const store = {
    s: { watched: [1], ignored: [], seen: null, imported: {} },
    snapshot() {
      return structuredClone(this.s);
    },
    applyMerged(next) {
      Object.assign(this.s, structuredClone(next));
    },
    subscribe: () => () => {},
  };
  const drive = {
    async read(token) {
      if (token !== cloud.validToken) throw new DriveAuthError();
      return { id: cloud.id, data: cloud.file ? structuredClone(cloud.file) : null };
    },
    async write(token, id, data) {
      cloud.id = id || "f";
      cloud.file = structuredClone(data);
    },
    async account() {
      return "me@example.com";
    },
  };
  const issue = () => {
    state.issued++;
    cloud.validToken = `tok-${state.issued}`;
    return { access_token: cloud.validToken, expires_in: 3600 };
  };
  const gis = {
    async requestCode() {
      calls.codes++;
      return "code-1";
    },
    async revoke(t) {
      calls.revoked.push(t);
    },
  };
  const server = {
    async connect(code) {
      assert.equal(code, "code-1");
      state.cookie = cookie;
      return { ...issue(), persistent: persistent && cookie };
    },
    async token() {
      calls.tokens++;
      if (!state.cookie) throw new DriveAuthError("Нужно войти в Google заново.");
      return issue();
    },
    async disconnect() {
      calls.disconnects++;
      state.cookie = false;
    },
  };
  const saved = { value: {} };
  const make = () =>
    createSync({
      store,
      drive,
      gis,
      server,
      readSettings: () => structuredClone(saved.value),
      writeSettings: (v) => (saved.value = structuredClone(v)),
      now: () => now.t,
      changeDelay: 5,
    });
  return { make, now, calls, state, saved, cloud, store };
}

test("после одного входа просроченный токен обновляется сам, без нового окна", async () => {
  const t = setup();
  const sync = t.make();
  assert.equal(await sync.connect(), true);
  assert.equal(sync.state().persistent, true);
  assert.equal(t.calls.codes, 1);
  t.now.t += 3 * 3600 * 1000; // прошло три часа
  assert.equal(await sync.syncNow(), true);
  assert.equal(t.calls.codes, 1, "окно входа больше не открывалось");
  assert.equal(t.calls.tokens, 1);
  assert.equal(sync.state().status, "idle");
});

test("после перезагрузки страницы синхронизация стартует сама с просроченным токеном", async () => {
  const t = setup();
  await t.make().connect();
  t.now.t += 5 * 3600 * 1000;
  const reopened = t.make();
  assert.equal(reopened.state().status, "idle", "не «нужно войти»");
  reopened.start({ addEventListener() {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.calls.tokens, 1);
  assert.equal(reopened.state().status, "idle");
  assert.ok(reopened.state().last > 1_000_000 + 5 * 3600 * 1000 - 1);
});

test("токен отозван на стороне Google: берём новый по куке и повторяем обмен", async () => {
  const t = setup();
  const sync = t.make();
  await sync.connect();
  t.cloud.validToken = "other"; // Drive отклонит текущий токен, хотя по времени он ещё действует
  assert.equal(await sync.syncNow(), true);
  assert.equal(t.calls.tokens, 1);
  assert.equal(t.calls.codes, 1);
});

test("кука пропала или доступ отозван: нужен вход, а не тихая ошибка", async () => {
  const t = setup();
  const sync = t.make();
  await sync.connect();
  t.state.cookie = false;
  t.now.t += 2 * 3600 * 1000;
  assert.equal(await sync.syncNow(), true, "по клику окно входа откроется заново");
  assert.equal(t.calls.codes, 2);

  t.state.cookie = false;
  t.now.t += 2 * 3600 * 1000;
  const reopened = t.make();
  reopened.start({ addEventListener() {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(reopened.state().status, "idle");
});

test("Google не выдал постоянный доступ: работает как раньше, раз в час", async () => {
  const t = setup({ cookie: false });
  const sync = t.make();
  await sync.connect();
  assert.equal(sync.state().persistent, false);
  assert.equal(sync.state().canPersist, true);
  t.now.t += 2 * 3600 * 1000;
  assert.equal(t.make().state().status, "needs-login");
});

test("отключение стирает куку на сервере и отзывает доступ там же", async () => {
  const t = setup();
  const sync = t.make();
  await sync.connect();
  await sync.disconnect();
  assert.equal(t.calls.disconnects, 1);
  assert.deepEqual(t.calls.revoked, []);
  assert.equal(t.state.cookie, false);
  assert.equal(sync.state().status, "off");
});

// --- gserver.js ---------------------------------------------------------------------------------------------

function fetcher(res) {
  const seen = [];
  const fn = async (url, init) => {
    seen.push({ url, init });
    if (res instanceof Error) throw res;
    return res;
  };
  fn.seen = seen;
  return fn;
}
const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

test("gserver: запросы идут с защитным заголовком и кукой, токен возвращается", async () => {
  const f = fetcher(json(200, { access_token: "a", expires_in: 3600 }));
  const res = await createServerAuth(f).token();
  assert.equal(res.access_token, "a");
  assert.equal(f.seen[0].url, "/api/google/token");
  assert.equal(f.seen[0].init.method, "POST");
  assert.equal(f.seen[0].init.headers["X-Requested-With"], "animecalendar");
  assert.equal(f.seen[0].init.credentials, "same-origin");
});

test("gserver: 401 значит «войти заново», сбой сервера и сети — обычные ошибки", async () => {
  await assert.rejects(createServerAuth(fetcher(json(401, {}))).token(), DriveAuthError);
  await assert.rejects(createServerAuth(fetcher(json(502, { detail: "Google недоступен" }))).token(), (e) => e instanceof SyncError && !(e instanceof DriveAuthError) && e.message === "Google недоступен");
  await assert.rejects(createServerAuth(fetcher(new TypeError("offline"))).token(), (e) => e.code === "network");
});

test("gserver: connect передаёт код и показывает причину отказа", async () => {
  const f = fetcher(json(200, { access_token: "a", expires_in: 1, persistent: true }));
  assert.equal((await createServerAuth(f).connect("abc")).persistent, true);
  assert.deepEqual(JSON.parse(f.seen[0].init.body), { code: "abc" });
  await assert.rejects(createServerAuth(fetcher(json(400, { detail: "Не дан доступ" }))).connect("x"), /Не дан доступ/);
});
