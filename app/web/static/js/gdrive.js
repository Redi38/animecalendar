// Файл синхронизации в скрытой папке приложения на Google Диске (scope drive.appdata): остальные файлы Диска
// сайту недоступны. Работает по REST прямо из браузера; fetch подставляется снаружи, чтобы проверять без сети.

import { DriveAuthError, SyncError } from "./syncerrors.js";

export const FILE_NAME = "anime-calendar-sync.json";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export function createDrive(fetchFn = (...args) => fetch(...args)) {
  async function call(url, token, init = {}) {
    let res;
    try {
      res = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    } catch {
      throw new SyncError("network", "Нет связи с Google. Попробуем позже.");
    }
    if (res.status === 401) throw new DriveAuthError();
    if (res.status === 403) {
      // 403 бывает и от лимитов запросов, и от отозванных прав: отличаем по причине в ответе.
      const reason = await res.json().then((j) => j?.error?.errors?.[0]?.reason || j?.error?.status || "", () => "");
      if (/rateLimit|userRateLimit|quota/i.test(reason)) throw new SyncError("drive", "Google просит подождать: слишком много запросов.");
      throw new DriveAuthError("Нет доступа к Google Диску. Войдите снова и разрешите доступ.");
    }
    if (!res.ok) throw new SyncError("drive", `Google Диск ответил ошибкой (${res.status}).`);
    return res;
  }

  return {
    /** { id, data }: id файла (null, если его ещё нет) и его содержимое (null, если файла нет или он повреждён). */
    async read(token) {
      const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
      const list = await (
        await call(`${API}/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime%20desc&pageSize=1&fields=files(id)`, token)
      ).json();
      const id = list?.files?.[0]?.id ?? null;
      if (!id) return { id: null, data: null };
      const res = await call(`${API}/files/${encodeURIComponent(id)}?alt=media`, token);
      const data = await res.json().catch(() => null);
      return { id, data };
    },

    /** Записывает содержимое; создаёт файл, если id нет. Возвращает id файла. */
    async write(token, id, data) {
      const body = JSON.stringify(data);
      if (id) {
        await call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id`, token, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
        });
        return id;
      }
      const boundary = `ac${Math.random().toString(36).slice(2)}`;
      const meta = JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" });
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
      const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, token, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      return (await res.json()).id;
    },

    /** Имя аккаунта для подписи; необязательно, при любой ошибке null. */
    async account(token) {
      try {
        const res = await call(`${API}/about?fields=user(emailAddress,displayName)`, token);
        const user = (await res.json())?.user;
        return user?.emailAddress || user?.displayName || null;
      } catch {
        return null;
      }
    },
  };
}
