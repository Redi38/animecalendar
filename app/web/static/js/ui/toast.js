import { h } from "../util.js";

export function toast(message, kind = "info") {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" }, message);
  host.append(el);
  setTimeout(() => el.remove(), kind === "error" ? 6000 : 3500);
}
