import { createDrive } from "../gdrive.js";
import { createGis } from "../gis.js";
import { createServerAuth } from "../gserver.js";
import { readJson, writeJson } from "../storage.js";
import { store } from "../store.js";
import { SYNC_KEY, createSync } from "../sync.js";
import { clear, h } from "../util.js";
import { closeDialogAnimated } from "./motion.js";
import { toast } from "./toast.js";

const TITLES = {
  off: "Синхронизация между устройствами",
  idle: "Синхронизация включена",
  syncing: "Синхронизируем…",
  "needs-login": "Нужно войти в Google заново",
  error: "Не удалось синхронизировать",
};

function lastText(ms) {
  if (!ms) return "ещё не было";
  return new Date(ms).toLocaleString("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** После ручной синхронизации говорим, что произошло: список мог обновиться из облака. */
function reportResult(sync, ok) {
  if (!ok) return;
  const { applied, uploaded, truncated } = sync.state().result;
  if (truncated) toast("Список не поместился в 500 тайтлов, лишнее не сохранено.", "error");
  toast(applied ? "Список обновлён из Google Диска" : uploaded ? "Список сохранён на Google Диске" : "Всё уже синхронизировано");
}

function openDialog(sync) {
  const previous = document.activeElement;
  const dlg = h("dialog", { class: "confirm-dialog sync-dialog", "aria-labelledby": "sync-title" });
  const body = h("div", { class: "confirm-body" });
  const close = h("button", { type: "button", class: "dialog-close", "aria-label": "Закрыть", onclick: () => closeDialogAnimated(dlg) }, "✕");
  dlg.append(close, body);

  function render() {
    const s = sync.state();
    const busy = s.status === "syncing";
    const connected = s.configured && s.status !== "off";
    const text =
      s.status === "off"
        ? "Список просмотренного и скрытые тайтлы будут храниться в вашем Google Диске, в скрытой папке этого сайта. Остальные файлы на Диске сайту недоступны, а сам сайт ваш список не хранит. Войдите на другом устройстве с тем же аккаунтом, и списки объединятся."
        : s.status === "idle"
          ? s.persistent
            ? "Список сам сверяется с Google Диском при изменениях и когда вы возвращаетесь на вкладку. Вход сохранён, повторно входить не нужно."
            : "Список сам сверяется с Google Диском при изменениях и когда вы возвращаетесь на вкладку."
          : s.message || (s.status === "needs-login" ? "Вход действует около часа. Войдите снова, и изменения с этого устройства сохранятся." : "");
    const facts = connected
      ? h(
          "p",
          { class: "confirm-text sync-facts" },
          s.email ? h("span", null, `Аккаунт: ${s.email}`) : null,
          h("span", null, `Последняя синхронизация: ${lastText(s.last)}`),
        )
      : null;

    const primary =
      s.status === "off"
        ? h("button", { type: "button", class: "btn btn-primary", onclick: () => act(() => sync.connect()) }, "Войти через Google")
        : s.status === "needs-login"
          ? h("button", { type: "button", class: "btn btn-primary", onclick: () => act(() => sync.syncNow()) }, "Войти снова")
          : h(
              "button",
              { type: "button", class: "btn btn-primary", disabled: busy, onclick: () => act(() => sync.syncNow()) },
              s.status === "error" ? "Повторить" : "Синхронизировать",
            );
    const off = connected
      ? h(
          "button",
          {
            type: "button",
            class: "btn btn-danger sync-off",
            disabled: busy,
            onclick: async () => {
              await sync.disconnect();
              toast("Синхронизация отключена. Список остаётся на этом устройстве и на вашем Google Диске.");
            },
          },
          "Отключить",
        )
      : null;

    // append() у элемента не пропускает null и написал бы в окно слово «null», поэтому пустые части убираем.
    const parts = [
      h("div", { class: `confirm-icon sync-icon is-${s.status}`, "aria-hidden": "true" }, "☁"),
      h("h2", { id: "sync-title" }, TITLES[s.status] || TITLES.off),
      // Вход не удался или отменён: причину показываем отдельно над обычным пояснением.
      s.status === "off" && s.message ? h("p", { class: "confirm-text sync-warn", role: "alert" }, s.message) : null,
      s.status === "idle" && s.canPersist && !s.persistent
        ? h("p", { class: "confirm-text sync-warn" }, "Google не выдал постоянный доступ, поэтому входить придётся примерно раз в час. Чтобы это исправить: отключите синхронизацию, удалите это приложение на myaccount.google.com/permissions и подключите снова.")
        : null,
      text ? h("p", { class: "confirm-text", role: s.status === "error" ? "alert" : null }, text) : null,
      facts,
      h("div", { class: "confirm-actions" }, primary),
      off,
    ].filter(Boolean);
    clear(body).append(...parts);
  }

  // Клик обязан запускать окно входа сам (иначе браузер его заблокирует), поэтому ждём результат прямо здесь.
  async function act(run) {
    const ok = await run();
    reportResult(sync, ok);
  }

  const unsubscribe = sync.subscribe(render);
  dlg.addEventListener("close", () => {
    unsubscribe();
    dlg.remove();
    previous?.focus?.();
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) closeDialogAnimated(dlg);
  });
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDialogAnimated(dlg);
  });
  render();
  document.body.append(dlg);
  dlg.showModal();
}

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
  btn.addEventListener("click", () => openDialog(sync));
  sync.start();
  return sync;
}
