import { h } from "../util.js";
import { closeDialogAnimated } from "./motion.js";

/** Окно подтверждения в стиле сайта вместо системного confirm(). Resolve: true — подтвердили. */
export function confirmDialog({ title, text, confirmLabel = "Подтвердить", cancelLabel = "Отмена", danger = false }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const cancelBtn = h("button", { type: "button", class: "btn", onclick: () => closeDialogAnimated(dlg, "cancel") }, cancelLabel);
    const okBtn = h(
      "button",
      { type: "button", class: danger ? "btn btn-danger-solid" : "btn btn-primary", onclick: () => closeDialogAnimated(dlg, "ok") },
      confirmLabel,
    );
    const dlg = h(
      "dialog",
      { class: `confirm-dialog${danger ? " is-danger" : ""}`, "aria-labelledby": "confirm-title" },
      h(
        "div",
        { class: "confirm-body" },
        h("div", { class: "confirm-icon", "aria-hidden": "true" }, "!"),
        h("h2", { id: "confirm-title" }, title),
        h("p", { class: "confirm-text" }, text),
        h("div", { class: "confirm-actions" }, cancelBtn, okBtn),
      ),
    );
    dlg.addEventListener("close", () => {
      const confirmed = dlg.returnValue === "ok";
      dlg.remove();
      if (previous && previous.focus) previous.focus();
      resolve(confirmed);
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) closeDialogAnimated(dlg, "cancel"); // клик по затемнению
    });
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault(); // Esc: закрываем с анимацией
      closeDialogAnimated(dlg, "cancel");
    });
    document.body.append(dlg);
    dlg.showModal();
    cancelBtn.focus(); // фокус на безопасной кнопке: случайный Enter ничего не удалит
  });
}
