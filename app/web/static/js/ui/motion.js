/** Общие помощники для анимаций интерфейса. */

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Проигрывает появление содержимого заново (карточки выезжают по очереди). Класс сам снимается. */
export function replayEnter(el, ms = 900) {
  el.classList.remove("is-entering");
  void el.offsetWidth; // перезапуск CSS-анимации
  el.classList.add("is-entering");
  clearTimeout(el._enterTimer);
  el._enterTimer = setTimeout(() => el.classList.remove("is-entering"), ms);
}

/** Закрывает <dialog> с анимацией. returnValue попадает в dialog.returnValue, как у close(). */
export function closeDialogAnimated(dialog, returnValue) {
  if (!dialog.open || dialog.classList.contains("is-closing")) return;
  if (reducedMotion()) {
    dialog.close(returnValue);
    return;
  }
  dialog.classList.add("is-closing");
  let done = false;
  const onEnd = (e) => {
    if (e.target === dialog) finish();
  };
  const finish = () => {
    if (done) return;
    done = true;
    dialog.removeEventListener("animationend", onEnd);
    // Пока шла анимация, окно могли открыть заново (переход к другому тайтлу): тогда не закрываем.
    if (!dialog.classList.contains("is-closing")) return;
    dialog.classList.remove("is-closing");
    if (dialog.open) dialog.close(returnValue);
  };
  dialog.addEventListener("animationend", onEnd);
  setTimeout(finish, 280); // запасной вариант, если animationend не пришёл
}

/** Плавно убирает блок и сообщает, когда можно подставлять новое содержимое. */
export function fadeOut(el, ms = 140) {
  el.classList.add("is-leaving");
  return new Promise((resolve) => setTimeout(resolve, ms));
}
