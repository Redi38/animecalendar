// Вход через Google (Google Identity Services, token model). Скрипт Google грузится только тогда, когда пользователь
// сам нажал «Войти»: пока синхронизация не включена, к Google страница не обращается.

import { SyncError } from "./syncerrors.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";
export const SCOPE = "https://www.googleapis.com/auth/drive.appdata";

export function createGis(clientId) {
  let loading = null;

  function load() {
    if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
    loading ||= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new SyncError("load", "Не удалось загрузить вход Google. Проверьте интернет и блокировщики рекламы."));
      };
      document.head.append(script);
    });
    return loading;
  }

  return {
    /** Окно входа Google; нужно вызывать из обработчика клика, иначе браузер заблокирует окно. { access_token, expires_in } */
    async request() {
      await load();
      return new Promise((resolve, reject) => {
        const client = globalThis.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: (res) =>
            res?.access_token
              ? resolve(res)
              : reject(new SyncError(res?.error === "access_denied" ? "cancelled" : "popup", "Вход в Google не удался или был отменён.")),
          error_callback: (err) =>
            reject(
              err?.type === "popup_failed_to_open"
                ? new SyncError("popup", "Браузер заблокировал окно входа. Разрешите всплывающие окна для сайта и повторите.")
                : new SyncError("cancelled", "Вход в Google отменён."),
            ),
        });
        client.requestAccessToken({ prompt: "" });
      });
    },

    /** Окно входа Google для постоянного входа: возвращает одноразовый код, его сервер меняет на refresh-токен. */
    async requestCode() {
      await load();
      return new Promise((resolve, reject) => {
        const client = globalThis.google.accounts.oauth2.initCodeClient({
          client_id: clientId,
          scope: SCOPE,
          ux_mode: "popup",
          callback: (res) =>
            res?.code
              ? resolve(res.code)
              : reject(new SyncError(res?.error === "access_denied" ? "cancelled" : "popup", "Вход в Google не удался или был отменён.")),
          error_callback: (err) =>
            reject(
              err?.type === "popup_failed_to_open"
                ? new SyncError("popup", "Браузер заблокировал окно входа. Разрешите всплывающие окна для сайта и повторите.")
                : new SyncError("cancelled", "Вход в Google отменён."),
            ),
        });
        client.requestCode();
      });
    },

    /** Отзывает доступ сайта к Google Диску (файл в облаке остаётся). */
    async revoke(token) {
      try {
        await load();
        await new Promise((resolve) => globalThis.google.accounts.oauth2.revoke(token, () => resolve()));
      } catch {
        /* отзыв необязателен: локально синхронизация всё равно выключена */
      }
    },
  };
}
