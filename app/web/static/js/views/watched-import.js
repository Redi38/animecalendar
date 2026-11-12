import { parseListFile, resolveTitles } from "../importer.js";
import { toast } from "../ui/toast.js";
import { clear, fill, h } from "../util.js";

/**
 * Загрузка списка из файла: JSON с ID добавляется сразу, JSON с названиями ищется в каталоге, итог показывается
 * отчётом. status и report — блоки на странице (ход поиска и итог); signal отменяет поиск при уходе со страницы.
 * Возвращает { input, open }: скрытое поле файла (его нужно вставить в страницу) и вызов выбора файла.
 */
export function createListFile({ store, status, report, signal }) {
  let importing = false;

  function showReport(summary, failed) {
    const parts = [h("p", null, summary)];
    if (failed.length) {
      parts.push(
        h("p", null, "Эти тайтлы не добавлены:"),
        h("ul", null, failed.map((f) => h("li", null, `${f.title}: ${f.reason}`))),
      );
    }
    parts.push(h("button", { type: "button", class: "btn", onclick: () => clear(report) }, "Закрыть"));
    fill(report, h("div", { class: "notice", role: "alert" }, parts));
  }

  async function importTitles({ titles, skipped }) {
    if (importing) return;
    importing = true;
    clear(report);
    try {
      const { found, failed } = await resolveTitles(
        titles,
        (done, total) => {
          status.textContent = done < total ? `Ищем тайтлы: ${done} из ${total}…` : "";
        },
        signal,
      );
      store.addImported(found);
      const inList = new Set(store.ids());
      for (const f of found) {
        if (!inList.has(f.id)) failed.push({ title: f.title, reason: "список переполнен, максимум 500 тайтлов" });
      }
      const ok = titles.length - failed.length;
      const extra = skipped ? ` Записей без названия в файле: ${skipped}.` : "";
      showReport(`Обработано названий: ${titles.length}. В списке: ${ok}, не добавлено: ${failed.length}.${extra}`, failed);
    } catch (err) {
      if (err.name !== "AbortError") toast("Не удалось найти тайтлы. Попробуйте позже.", "error");
    } finally {
      importing = false;
      status.textContent = "";
    }
  }

  const input = h("input", {
    type: "file",
    accept: "application/json,.json",
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const parsed = parseListFile(JSON.parse(await file.text()));
        if (parsed.kind === "titles") {
          toast(`Ищем ${parsed.titles.length} тайтлов по названиям, это займёт пару минут`);
          importTitles(parsed);
          return;
        }
        const added = store.addMany(parsed.ids);
        toast(added ? `Добавлено тайтлов: ${added}` : "Новых тайтлов в файле нет");
      } catch {
        toast("Не удалось прочитать файл. Нужен JSON, который вы скачали здесь же.", "error");
      }
    },
  });

  return { input, open: () => input.click() };
}
