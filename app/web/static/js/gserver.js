// Клиент серверных ручек постоянного входа (/api/google/*): код входа меняется на куку с refresh-токеном,
// дальше свежий access-токен выдаётся без окон и кликов. Подробнее: app/web/gauth.py.

import { DriveAuthError, SyncError } from "./syncerrors.js";

const HEADERS = { "Content-Type": "application/json", "X-Requested-With": "animecalendar" };

export function createServerAuth(fetchFn = globalThis.fetch?.bind(globalThis)) {
  async function post(path, body) {
    let res;
    try {
      res = await fetchFn(`/api/google/${path}`, { method: "POST", headers: HEADERS, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    } catch {
      throw new SyncError("network", "Нет связи с сервером. Проверьте интернет.");
    }
    return res;
  }
  const detail = async (res, fallback) => {
    try {
      const data = await res.json();
      return typeof data?.detail === "string" ? data.detail : fallback;
    } catch {
      return fallback;
    }
  };

  return {
    /** Обменивает код из окна входа Google на токен. { access_token, expires_in, persistent } */
    async connect(code) {
      const res = await post("connect", { code });
      if (!res.ok) throw new SyncError("auth", await detail(res, "Не удалось войти в Google."));
      return res.json();
    },

    /** Свежий access-токен по куке. 401 — войти нужно заново. { access_token, expires_in } */
    async token() {
      const res = await post("token");
      if (res.status === 401) throw new DriveAuthError("Нужно войти в Google заново.");
      if (!res.ok) throw new SyncError("network", await detail(res, "Google сейчас недоступен. Попробуем позже."));
      return res.json();
    },

    /** Отзывает доступ и стирает куку. Ошибки не важны: локально синхронизация всё равно выключена. */
    async disconnect() {
      try {
        await post("disconnect");
      } catch {
        /* нет связи: кука останется, но без включённой синхронизации она не используется */
      }
    },
  };
}
