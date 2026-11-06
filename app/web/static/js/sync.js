// Синхронизация списка между устройствами: вход через Google, чтение и запись файла на Диске, слияние.
// Все зависимости (store, drive, gis, хранилище, часы) подставляются снаружи, поэтому логику можно проверять без браузера.

import { DriveAuthError, SyncError } from "./syncerrors.js";
import { mergeState, normalize, sameState, toFile } from "./syncmerge.js";

export const SYNC_KEY = "anime_calendar_sync_v1";
const TOKEN_MARGIN_MS = 60_000; // токен считаем просроченным за минуту до конца
const CHANGE_DELAY_MS = 3000; // после правки списка ждём, вдруг будут ещё
const STALE_MS = 60_000; // вернулись на вкладку: синхронизируем, если с прошлого раза прошло больше минуты

/**
 * Состояния: off (не подключено), idle (всё синхронно), syncing, needs-login (токен истёк), error.
 * Токен доступа живёт около часа и лежит в localStorage этого браузера, чтобы синхронизация переживала перезагрузку
 * страницы. Он даёт доступ только к скрытой папке этого приложения на Диске. «Отключить» отзывает его.
 */
export function createSync({ store, drive, gis, readSettings, writeSettings, now = Date.now, changeDelay = CHANGE_DELAY_MS }) {
  const loaded = readSettings();
  let settings = loaded && typeof loaded === "object" ? loaded : {};
  const listeners = new Set();
  let status = "off";
  let message = "";
  let busy = null;
  let pending = false;
  let timer = 0;
  let lastResult = { applied: false, uploaded: false, truncated: false };

  const tokenValid = () => Boolean(settings.token) && Number(settings.expires) - now() > TOKEN_MARGIN_MS;
  status = settings.enabled ? (tokenValid() ? "idle" : "needs-login") : "off";

  const save = () => writeSettings(settings);
  const emit = () => {
    for (const fn of listeners) fn(api.state());
  };
  function setStatus(next, text = "") {
    status = next;
    message = text;
    emit();
  }

  async function login() {
    const res = await gis.request();
    settings.token = res.access_token;
    settings.expires = now() + Number(res.expires_in || 3600) * 1000;
    save();
    drive.account(settings.token).then((who) => {
      if (who && who !== settings.email) {
        settings.email = who;
        save();
        emit();
      }
    });
  }

  /** Один обмен с облаком: прочитать, слить, применить у себя, записать в облако. */
  async function exchange() {
    const token = settings.token;
    const remote = await drive.read(token);
    const remoteState = normalize(remote.data);
    // От чтения снимка до применения слияния нет await: правки пользователя не потеряются между ними.
    const local = store.snapshot();
    const { state, truncated } = mergeState(local, remoteState, settings.base);
    const applied = !sameState(state, local);
    if (applied) store.applyMerged(state);
    const uploaded = remote.id === null || !remoteState || !sameState(state, remoteState);
    if (uploaded) await drive.write(token, remote.id, toFile(state, new Date(now())));
    settings.base = { watched: state.watched, ignored: state.ignored };
    settings.last = now();
    save();
    lastResult = { applied, uploaded, truncated };
  }

  async function run(interactive) {
    setStatus("syncing");
    try {
      if (!tokenValid()) {
        if (!interactive) {
          setStatus("needs-login");
          return false;
        }
        await login();
      }
      try {
        await exchange();
      } catch (err) {
        if (!(err instanceof DriveAuthError)) throw err;
        settings.token = null;
        save();
        if (!interactive) {
          setStatus("needs-login", err.message);
          return false;
        }
        await login();
        await exchange();
      }
      setStatus("idle");
      return true;
    } catch (err) {
      if (err instanceof DriveAuthError) setStatus("needs-login", err.message);
      else setStatus("error", err instanceof SyncError ? err.message : "Не удалось синхронизировать. Попробуем позже.");
      return false;
    }
  }

  function sync({ interactive = false } = {}) {
    if (!settings.enabled) return Promise.resolve(false);
    if (busy) {
      pending = true; // правки пришли во время обмена: сделаем ещё один сразу после него
      return busy;
    }
    busy = run(interactive).finally(() => {
      busy = null;
      if (pending) {
        pending = false;
        schedule(Math.min(500, changeDelay));
      }
    });
    return busy;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => sync(), ms);
  }

  const api = {
    state: () => ({
      status,
      message,
      email: settings.email || null,
      last: settings.last || null,
      configured: Boolean(settings.enabled),
      result: lastResult,
    }),

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Включает синхронизацию: вход в Google и первый обмен (объединение). Вызывать из обработчика клика. */
    async connect() {
      settings = { enabled: true };
      save();
      const ok = await sync({ interactive: true });
      if (!ok && !tokenValid()) {
        const text = message;
        settings = {};
        save();
        setStatus("off", text);
      }
      return ok;
    },

    /** Войти заново и синхронизировать (токен истёк). Вызывать из обработчика клика. */
    syncNow: () => sync({ interactive: true }),

    async disconnect() {
      clearTimeout(timer);
      const token = settings.token;
      settings = {};
      save();
      setStatus("off");
      if (token) await gis.revoke(token);
    },

    /** Подписка на правки списка и возвращение на вкладку; первый обмен, если вход ещё действует. */
    start(doc = globalThis.document) {
      store.subscribe((source) => {
        if (source === "sync" || !settings.enabled) return; // свои же применения не считаем правками
        schedule(changeDelay);
      });
      doc?.addEventListener?.("visibilitychange", () => {
        if (doc.visibilityState === "visible" && settings.enabled && tokenValid() && now() - (settings.last || 0) > STALE_MS) sync();
      });
      if (settings.enabled && tokenValid()) sync();
    },
  };
  return api;
}
