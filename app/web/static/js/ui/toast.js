import { h } from "../util.js";

const LIFETIME_MS = 3500; // сколько висит обычное уведомление
const ERROR_LIFETIME_MS = 6000; // ошибку читают дольше
const LEAVE_FALLBACK_MS = 500; // запасной срок удаления, если анимация ухода не сработала

/** hint — вторая, отдельная строка покрупнее и цветом сайта (например, «как это вернуть»). */
export function toast(message, kind = "info", hint = null) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" }, message, hint ? h("span", { class: "toast-hint" }, hint) : null);
  host.append(el);
  const lifetime = kind === "error" ? ERROR_LIFETIME_MS : LIFETIME_MS;
  setTimeout(() => {
    el.classList.add("is-leaving"); // плавно уходит, потом удаляется
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), LEAVE_FALLBACK_MS); // запасной вариант, если анимации отключены
  }, lifetime);
}
