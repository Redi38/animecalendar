// Небольшие помощники: сборка DOM без innerHTML (данные приходят из внешних API), даты, склонения.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Нормализация для поиска: регистр, ё=е, знаки препинания -> пробелы. */
export function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const pluralRules = new Intl.PluralRules("ru");
/** plural(5, ["серия", "серии", "серий"]) -> "серий" */
export function plural(n, [one, few, many]) {
  const form = pluralRules.select(n);
  return form === "one" ? one : form === "few" ? few : many;
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Цвет обложки приходит из API — пропускаем в CSS только то, что похоже на hex. */
export function safeColor(color) {
  return typeof color === "string" && /^#[0-9a-f]{3,8}$/i.test(color) ? color : null;
}

// --- даты ---------------------------------------------------------------------

const fmtDay = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });
const fmtDayShort = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" });
const fmtDayLong = new Intl.DateTimeFormat("ru", { weekday: "long", day: "numeric", month: "long" });
const fmtMonth = new Intl.DateTimeFormat("ru", { month: "long" });

/** 'YYYY-MM-DD' -> локальная дата (без сдвига часового пояса). */
export function parseDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Дата премьеры для людей. style: "short" | "long" | "group". */
export function formatStart(start, precision, style = "long") {
  if (!start) return "дата не объявлена";
  const yearNow = new Date().getFullYear();
  if (precision === "day") {
    const d = parseDay(start);
    const fmt = style === "short" ? fmtDayShort : style === "group" ? fmtDayLong : fmtDay;
    const text = fmt.format(d);
    return d.getFullYear() === yearNow ? text : `${text} ${d.getFullYear()}`;
  }
  if (precision === "month") {
    const [y, m] = start.split("-").map(Number);
    return `${fmtMonth.format(new Date(y, m - 1, 1))} ${y}`;
  }
  return `${start} год`;
}

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
/** «через 2 дня», «через 5 ч.» по unix-времени выхода серии. */
export function untilText(unixSeconds) {
  const diff = unixSeconds * 1000 - Date.now();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(diff / 3600000);
  if (Math.abs(hours) < 48) return rtf.format(hours, "hour");
  return rtf.format(Math.round(diff / 86400000), "day");
}

export function formatEpisodes(n) {
  return n ? `${n} ${plural(n, ["серия", "серии", "серий"])}` : null;
}
