// Тонкая обёртка над localStorage: в приватном режиме или при переполнении хранилище бросает исключения,
// а все наши настройки некритичны — без хранилища приложение просто не запоминает выбор.

export function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** JSON по ключу; fallback — если записи нет, она повреждена или хранилище недоступно. */
export function readJson(key, fallback = null) {
  const raw = storageGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  return storageSet(key, JSON.stringify(value));
}
