import assert from "node:assert/strict";
import test from "node:test";

const { createDrive, FILE_NAME } = await import("../../app/web/static/js/gdrive.js");
const { DriveAuthError, SyncError } = await import("../../app/web/static/js/syncerrors.js");

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

test("read: файла ещё нет", async () => {
  const f = fakeFetch(() => json({ files: [] }));
  assert.deepEqual(await createDrive(f).read("tok"), { id: null, data: null });
  assert.match(f.calls[0].url, /spaces=appDataFolder/);
  assert.ok(f.calls[0].url.includes(encodeURIComponent(`name='${FILE_NAME}'`)));
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer tok");
});

test("read: находит файл и скачивает содержимое", async () => {
  const f = fakeFetch((url) => (url.includes("alt=media") ? json({ watched: [1, 2] }) : json({ files: [{ id: "f1" }] })));
  assert.deepEqual(await createDrive(f).read("tok"), { id: "f1", data: { watched: [1, 2] } });
  assert.match(f.calls[1].url, /files\/f1\?alt=media/);
});

test("read: повреждённый файл даёт data = null, но id остаётся (его перезапишем)", async () => {
  const f = fakeFetch((url) =>
    url.includes("alt=media") ? { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("bad")) } : json({ files: [{ id: "f1" }] }),
  );
  assert.deepEqual(await createDrive(f).read("tok"), { id: "f1", data: null });
});

test("write: без id создаёт файл в скрытой папке приложения", async () => {
  const f = fakeFetch(() => json({ id: "new1" }));
  const id = await createDrive(f).write("tok", null, { watched: [5] });
  assert.equal(id, "new1");
  const { url, init } = f.calls[0];
  assert.match(url, /upload\/drive\/v3\/files\?uploadType=multipart/);
  assert.equal(init.method, "POST");
  assert.match(init.headers["Content-Type"], /^multipart\/related; boundary=/);
  assert.ok(init.body.includes('"parents":["appDataFolder"]'));
  assert.ok(init.body.includes(`"name":"${FILE_NAME}"`));
  assert.ok(init.body.includes('{"watched":[5]}'));
});

test("write: с id обновляет содержимое через PATCH", async () => {
  const f = fakeFetch(() => json({ id: "f1" }));
  assert.equal(await createDrive(f).write("tok", "f1", { watched: [] }), "f1");
  assert.equal(f.calls[0].init.method, "PATCH");
  assert.match(f.calls[0].url, /files\/f1\?uploadType=media/);
});

test("401 — нужно войти заново", async () => {
  await assert.rejects(createDrive(fakeFetch(() => json({}, 401))).read("tok"), DriveAuthError);
});

test("403: лимит запросов — обычная ошибка, остальное — потеря доступа", async () => {
  const limited = fakeFetch(() => json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, 403));
  await assert.rejects(createDrive(limited).read("tok"), (e) => e instanceof SyncError && !(e instanceof DriveAuthError) && e.code === "drive");
  const denied = fakeFetch(() => json({ error: { errors: [{ reason: "insufficientPermissions" }] } }, 403));
  await assert.rejects(createDrive(denied).read("tok"), DriveAuthError);
});

test("сетевой сбой и прочие коды дают понятные ошибки", async () => {
  const offline = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(createDrive(offline).read("tok"), (e) => e.code === "network");
  await assert.rejects(createDrive(fakeFetch(() => json({}, 500))).read("tok"), (e) => e.code === "drive" && /500/.test(e.message));
});

test("account: подпись аккаунта необязательна и не ломает синхронизацию", async () => {
  assert.equal(await createDrive(fakeFetch(() => json({ user: { emailAddress: "a@b.c" } }))).account("tok"), "a@b.c");
  assert.equal(await createDrive(fakeFetch(() => json({}, 403))).account("tok"), null);
});
