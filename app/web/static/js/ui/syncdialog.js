import { fill, h } from "../util.js";
import { closeDialogAnimated } from "./motion.js";
import { toast } from "./toast.js";

export const TITLES = {
  off: "Синхронизация между устройствами",
  idle: "Синхронизация включена",
  syncing: "Синхронизируем…",
  "needs-login": "Нужно войти в Google заново",
  error: "Не удалось синхронизировать",
};

const INTRO =
  "Список просмотренного и скрытые тайтлы будут храниться в вашем Google Диске, в скрытой папке этого сайта. Остальные файлы на Диске сайту недоступны, а сам сайт ваш список не хранит. Войдите на другом устройстве с тем же аккаунтом, и списки объединятся.";
const NOT_PERSISTENT_HINT =
  "Google не выдал постоянный доступ, поэтому входить придётся примерно раз в час. Чтобы это исправить: отключите синхронизацию, удалите это приложение на myaccount.google.com/permissions и подключите снова.";

function lastText(ms) {
  if (!ms) return "ещё не было";
  return new Date(ms).toLocaleString("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** Пояснение под заголовком для текущего состояния синхронизации. */
function explanation(s) {
  if (s.status === "off") return INTRO;
  if (s.status === "idle") {
    const base = "Список сам сверяется с Google Диском при изменениях и когда вы возвращаетесь на вкладку.";
    return s.persistent ? `${base} Вход сохранён, повторно входить не нужно.` : base;
  }
  if (s.message) return s.message;
  return s.status === "needs-login"
    ? "Вход действует около часа. Войдите снова, и изменения с этого устройства сохранятся."
    : "";
}

/** После ручной синхронизации говорим, что произошло: список мог обновиться из облака. */
function reportResult(sync, ok) {
  if (!ok) return;
  const { applied, uploaded, truncated } = sync.state().result;
  if (truncated) toast("Список не поместился в 500 тайтлов, лишнее не сохранено.", "error");
  toast(applied ? "Список обновлён из Google Диска" : uploaded ? "Список сохранён на Google Диске" : "Всё уже синхронизировано");
}

/** Главная кнопка: войти, войти снова или синхронизировать — по состоянию. */
function primaryButton(s, busy, act, sync) {
  const button = (label, run, disabled = false) =>
    h("button", { type: "button", class: "btn btn-primary", disabled, onclick: () => act(run) }, label);
  if (s.status === "off") return button("Войти через Google", () => sync.connect());
  if (s.status === "needs-login") return button("Войти снова", () => sync.syncNow());
  return button(s.status === "error" ? "Повторить" : "Синхронизировать", () => sync.syncNow(), busy);
}

function disconnectButton(sync, busy) {
  return h(
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
  );
}

/** Окно синхронизации: перерисовывается при каждом изменении состояния, пока открыто. */
export function openSyncDialog(sync) {
  const previous = document.activeElement;
  const dlg = h("dialog", { class: "confirm-dialog sync-dialog", "aria-labelledby": "sync-title" });
  const body = h("div", { class: "confirm-body" });
  const close = h("button", { type: "button", class: "dialog-close", "aria-label": "Закрыть", onclick: () => closeDialogAnimated(dlg) }, "✕");
  dlg.append(close, body);

  // Клик обязан запускать окно входа сам (иначе браузер его заблокирует), поэтому ждём результат прямо здесь.
  async function act(run) {
    reportResult(sync, await run());
  }

  function render() {
    const s = sync.state();
    const busy = s.status === "syncing";
    const connected = s.configured && s.status !== "off";
    const text = explanation(s);
    fill(
      body,
      h("div", { class: `confirm-icon sync-icon is-${s.status}`, "aria-hidden": "true" }, "☁"),
      h("h2", { id: "sync-title" }, TITLES[s.status] || TITLES.off),
      // Вход не удался или отменён: причину показываем отдельно над обычным пояснением.
      s.status === "off" && s.message ? h("p", { class: "confirm-text sync-warn", role: "alert" }, s.message) : null,
      s.status === "idle" && s.canPersist && !s.persistent ? h("p", { class: "confirm-text sync-warn" }, NOT_PERSISTENT_HINT) : null,
      text ? h("p", { class: "confirm-text", role: s.status === "error" ? "alert" : null }, text) : null,
      connected
        ? h(
            "p",
            { class: "confirm-text sync-facts" },
            s.email ? h("span", null, `Аккаунт: ${s.email}`) : null,
            h("span", null, `Последняя синхронизация: ${lastText(s.last)}`),
          )
        : null,
      h("div", { class: "confirm-actions" }, primaryButton(s, busy, act, sync)),
      connected ? disconnectButton(sync, busy) : null,
    );
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
