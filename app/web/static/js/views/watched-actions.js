import { confirmDialog } from "../ui/confirm.js";
import { dropdown } from "../ui/dropdown.js";
import { listMenu } from "../ui/listmenu.js";
import { toast } from "../ui/toast.js";
import { SORTS } from "../watchedsort.js";
import { download, formatTitles, h } from "../util.js";

/**
 * Панель над списком просмотренного: сортировка и меню «Управление списком» (скачать, загрузить, очистить).
 * onSort(id) вызывается при смене сортировки; listFile — загрузка из файла (см. watched-import).
 */
export function watchedActions({ store, sort, onSort, listFile }) {
  return h(
    "div",
    { class: "toolbar-actions" },
    dropdown({
      label: "Сортировка",
      triggerText: "Сортировка",
      options: SORTS,
      value: sort,
      onChange: onSort,
    }),
    listMenu(() => {
      const items = [{ label: "Загрузить список", run: () => listFile.open() }];
      // Пока список пуст, скачивать и очищать нечего: остаётся только загрузка.
      if (store.size()) {
        items.unshift({
          label: "Скачать список",
          run: () => download("anime-watched.json", JSON.stringify({ watched: store.ids() })),
        });
        items.push({
          label: "Очистить",
          danger: true,
          run: async () => {
            const n = store.size();
            if (!n) return;
            const ok = await confirmDialog({
              title: "Очистить список просмотренного?",
              text: `Будет удалено ${formatTitles(n)}. Отменить это нельзя, поэтому сначала можно скачать список файлом.`,
              confirmLabel: "Очистить список",
              danger: true,
            });
            if (!ok) return;
            store.clear();
            toast("Список очищен");
          },
        });
      }
      return items;
    }),
    listFile.input,
  )
}
