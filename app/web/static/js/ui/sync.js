import { createDrive } from "../gdrive.js";
import { createGis } from "../gis.js";
import { createServerAuth } from "../gserver.js";
import { readJson, writeJson } from "../storage.js";
import { store } from "../store.js";
import { SYNC_KEY, createSync } from "../sync.js";
import { TITLES, openSyncDialog } from "./syncdialog.js";

/** Кнопка с облаком в шапке и сама синхронизация. Если сервер не знает ID клиента Google, кнопки нет. */
export function initSync(clientId, persistent = false) {
  const btn = document.getElementById("sync-btn");
  if (!clientId || !btn) return null;
  const sync = createSync({
    store,
    drive: createDrive(),
    gis: createGis(clientId),
    server: persistent ? createServerAuth() : null,
    readSettings: () => readJson(SYNC_KEY, {}),
    writeSettings: (value) => writeJson(SYNC_KEY, value),
  });
  const paint = () => {
    const s = sync.state();
    btn.dataset.state = s.status;
    const label = `Синхронизация: ${TITLES[s.status] || TITLES.off}`;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  };
  sync.subscribe(paint);
  paint();
  btn.hidden = false;
  btn.addEventListener("click", () => openSyncDialog(sync));
  sync.start();
  return sync;
}
