import { h } from "../util.js";

/** hint — вторая, отдельная строка покрупнее и цветом сайта (например, «как это вернуть»). */
export function toast(message, kind = "info", hint = null) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" }, message, hint ? h("span", { class: "toast-hint" }, hint) : null);
  host.append(el);
  const lifetime = kind === "error" ? 6000 : 3500;
  setTimeout(() => {
    el.classList.add("is-leaving"); // плавно уходит, потом удаляется
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 500); // запасной вариант, если анимации отключены
  }, lifetime);
}
