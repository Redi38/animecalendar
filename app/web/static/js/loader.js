import { errorBox } from "./ui/error.js";
import { fill, h } from "./util.js";

/** Заглушка «идёт загрузка»; роль status озвучивает её скринридерам. */
export function loadingBox(text) {
  return h("div", { class: "loading", role: "status" }, text);
}

/**
 * Загрузка данных для одного экрана. Берёт на себя то, что раньше повторял каждый экран:
 * общий AbortController, отмену при уходе со страницы, игнорирование устаревших ответов
 * (isCurrent) и блок ошибки с кнопкой «Повторить», которая перезагружает данные на месте.
 */
export function createLoader(isCurrent) {
  const controller = new AbortController();

  /**
   * Выполняет request(signal) и передаёт результат в onData. Вернёт true, если данные получены и показаны.
   * Отменённый запрос и ответ для уже закрытой страницы молча пропускаются. Ошибку (в том числе из onData)
   * получает onError(err).
   */
  async function run(request, onData, onError) {
    try {
      const data = await request(controller.signal);
      if (!isCurrent()) return false;
      await onData(data);
      return true;
    } catch (err) {
      if (err.name === "AbortError" || !isCurrent()) return false;
      onError(err);
      return false;
    }
  }

  /**
   * То же для экрана с одним блоком target: на время загрузки показывает заглушку (loading, если текст задан),
   * при ошибке рисует errorBox, повтор запускает ту же загрузку заново. Свой вид ошибки задаёт onError(err, retry).
   */
  function load(target, request, { loading, onData, onError }) {
    const retry = () => load(target, request, { loading, onData, onError });
    if (loading) fill(target, loadingBox(loading));
    return run(request, onData, (err) => {
      if (onError) onError(err, retry);
      else fill(target, errorBox(err.message, { onRetry: retry }));
    });
  }

  return { signal: controller.signal, abort: () => controller.abort(), run, load };
}
