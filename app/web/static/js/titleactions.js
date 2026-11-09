// Действия в карточке тайтла, которые зависят от страницы под ней: на каждой странице своё.
//   «Просмотрено» — переименовать (заменить ошибочно найденный тайтл правильным),
//   «Мои анонсы» — игнорировать (спрятать тайтл в «Скрытые»),
//   «Скрытые тайтлы» — вернуть в анонсы.

/**
 * store — список просмотренного и скрытых; toast — уведомление; pickTitle — окно выбора правильного тайтла
 * ({ current, query } -> выбранный тайтл или null); closeToBase — закрыть карточку и перерисовать страницу под ней;
 * goTo — перейти по адресу без записи в историю.
 */
export function createTitleActions({ store, toast, pickTitle, closeToBase, goTo }) {
  // Пользователь выбирает правильный тайтл, он встаёт на место ошибочного, а карточка переключается на него.
  async function rename(d) {
    const picked = await pickTitle({ current: d, query: store.importedAs(d.id) || d.title });
    if (!picked) return;
    const result = store.replace(d.id, picked.id);
    if (result === "unchanged") return;
    toast(result === "merged" ? `«${picked.title}» уже был в списке, прежний тайтл убран` : `Тайтл переименован: «${picked.title}»`);
    goTo(`#/title/${picked.id}`);
  }

  // Тайтл уходит в «Скрытые тайтлы», карточка закрывается.
  function ignore(d) {
    if (!store.ignore(d.id)) return toast("В списке скрытых может быть не больше 500 тайтлов.", "error");
    toast(`«${d.title}» скрыт из анонсов.`, "info", "Вернуть его можно на странице «Скрытые тайтлы».");
    closeToBase();
  }

  // «Вернуть в анонсы» в карточке из «Скрытых тайтлов».
  function restore(d) {
    if (!store.restore(d.id)) return;
    toast(`«${d.title}» снова в «Моих анонсах»`, "accent");
    closeToBase();
  }

  const byPage = {
    "#/watched": { onRename: rename },
    "#/upcoming": { onIgnore: ignore },
    "#/ignored": { onRestore: restore },
  };

  return {
    rename,
    ignore,
    restore,
    /** Какие действия показывает карточка, открытая поверх страницы baseHash. */
    forPage: (baseHash) => byPage[baseHash] || {},
  };
}
