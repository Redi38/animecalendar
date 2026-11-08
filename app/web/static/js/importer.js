// Загрузка списка из файла: названия ищутся через поиск сайта, первый результат попадает в список.

import { api } from "./api.js";

const SEARCH_PAUSE_MS = 1100; // сервер пускает не больше 60 поисков в минуту с одного IP
const RATE_LIMIT_WAIT_MS = 61000;

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** Названия из файла: массив строк или объектов {title}. Записи без названия пропускаются. Иначе null. */
export function titlesFromFile(data) {
  if (!Array.isArray(data) || !data.length) return null;
  const all = data.map((x) => (typeof x === "string" ? x : x && typeof x.title === "string" ? x.title : null));
  const titles = all.filter((t) => t && t.trim()).map((t) => t.trim());
  if (!titles.length) return null;
  return { titles, skipped: all.length - titles.length };
}

/** Что лежит в файле: названия (ищем по ним) или id (добавляем сразу). Бросает ошибку, если формат не наш. */
export function parseListFile(data) {
  const parsed = titlesFromFile(data);
  if (parsed) return { kind: "titles", ...parsed };
  const ids = Array.isArray(data) ? data : data?.watched;
  if (!Array.isArray(ids)) throw new Error("bad format");
  return { kind: "ids", ids };
}

/** Ищет каждое название через поиск сайта и берёт первый результат. */
export async function resolveTitles(titles, onProgress, signal) {
  const found = []; // { title, id }
  const failed = []; // { title, reason }
  for (let i = 0; i < titles.length; i++) {
    onProgress(i, titles.length);
    let items = null;
    let reason = "не найдено в каталоге";
    for (let attempt = 0; attempt < 2 && items === null; attempt++) {
      try {
        items = (await api.search(titles[i], true, signal)).items;
      } catch (err) {
        if (err.name === "AbortError") throw err;
        reason = err.status === 429 ? "слишком много запросов" : "ошибка поиска";
        if (err.status === 429 && attempt === 0) await sleep(RATE_LIMIT_WAIT_MS, signal);
        else break;
      }
    }
    if (items && items.length) found.push({ title: titles[i], id: items[0].id });
    else failed.push({ title: titles[i], reason });
    await sleep(SEARCH_PAUSE_MS, signal);
  }
  onProgress(titles.length, titles.length);
  return { found, failed };
}
