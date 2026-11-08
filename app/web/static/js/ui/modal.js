import { api } from "../api.js";
import { store } from "../store.js";
import { fill, h } from "../util.js";
import { closeDialogAnimated, fadeOut, reducedMotion } from "./motion.js";
import { titleBody, upgradeWatchLink } from "./titlebody.js";
import { closeMenus, titleMenu } from "./titlemenu.js";

export { setWatchTemplate } from "./titlebody.js";

let controller = null;

/**
 * Открывает карточку.
 * options.onRename(d) — если задан, а тайтл в списке просмотренного, в карточке появляется меню «⋯» с пунктом «Переименовать».
 * options.onIgnore(d) — «Игнорировать» (карточка открыта из «Моих анонсов»); options.onRestore(d) — «Вернуть» (из «Скрытых тайтлов»).
 * onClose вызывается, когда пользователь закрыл окно сам (Esc, крестик, клик по фону). */
export function openTitleDialog(id, onClose, { onRename, onIgnore, onRestore } = {}) {
  const dialog = document.getElementById("title-dialog");
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;

  dialog.classList.remove("is-closing"); // если окно как раз закрывалось, отменяем закрытие
  const wasOpen = dialog.open;
  const oldBody = dialog.querySelector(".dialog-body");
  // Переход между связанными тайтлами: старое содержимое плавно гаснет, пока грузится новое.
  const leave = wasOpen && oldBody && !reducedMotion() ? fadeOut(oldBody) : Promise.resolve();
  const request = api.title(id, signal);
  request.catch(() => {}); // ошибку разберёт цепочка ниже; здесь только чтобы не было «unhandled»

  dialog.oncancel = (event) => {
    event.preventDefault(); // Esc: закрываем с анимацией
    closeDialogAnimated(dialog);
  };
  dialog.onclose = () => {
    if (dialog.dataset.silent) return;
    onClose();
  };
  // Нажали на кнопку, увели курсор за карточку и отпустили: браузер шлёт click на «затемнение».
  // Закрываем только если и нажатие началось на затемнении.
  let pressedOnBackdrop = false;
  dialog.onpointerdown = (event) => {
    pressedOnBackdrop = event.target === dialog;
  };
  dialog.onclick = (event) => {
    if (event.target === dialog) {
      if (pressedOnBackdrop) closeDialogAnimated(dialog);
    }
    else if (!event.target.closest?.(".dialog-menu")) closeMenus(dialog);
    pressedOnBackdrop = false;
  };

  leave.then(() => {
    if (signal.aborted) return;
    const close = h("button", { type: "button", class: "dialog-close", "aria-label": "Закрыть", onclick: () => closeDialogAnimated(dialog) }, "✕");
    fill(dialog, close, h("div", { class: "dialog-body" }, h("div", { class: "loading", role: "status" }, "Загружаем…")));
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  });

  Promise.all([request, leave])
    .then(([d]) => {
      if (signal.aborted) return;
      const holder = dialog.querySelector(".dialog-body");
      fill(holder, ...titleBody(d));
      const actions = [];
      if (onRename && store.has(d.id)) actions.push({ label: "Переименовать", run: onRename });
      if (onIgnore && !store.isIgnored(d.id)) actions.push({ label: "Игнорировать", run: onIgnore });
      if (onRestore && store.isIgnored(d.id)) actions.push({ label: "Вернуть в анонсы", run: onRestore });
      if (actions.length) dialog.querySelector(".dialog-close")?.after(titleMenu(d, actions));
      upgradeWatchLink(holder, d, signal);
      holder.classList.add("is-entering");
      setTimeout(() => holder.classList.remove("is-entering"), 900);
      dialog.scrollTop = 0;
      document.title = `${d.title} — Аниме-календарь`;
    })
    .catch((err) => {
      if (err.name === "AbortError" || signal.aborted) return;
      const holder = dialog.querySelector(".dialog-body");
      fill(
        holder,
        h(
          "div",
          { class: "error-box", role: "alert" },
          h("h2", { id: "dialog-title" }, err.status === 404 ? "Тайтл не найден" : "Не удалось загрузить"),
          h("p", null, err.message),
        ),
      );
    });
}

/** Закрыть окно программно (например, при переходе на другую страницу) без вызова onClose. */
export function closeTitleDialog() {
  controller?.abort();
  const dialog = document.getElementById("title-dialog");
  if (dialog.open) {
    dialog.dataset.silent = "1";
    dialog.close();
    delete dialog.dataset.silent;
  }
}

