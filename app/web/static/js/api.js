export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { headers: { Accept: "application/json", ...(options.headers || {}) }, ...options });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет и попробуйте снова.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* тело не JSON — сообщим общей фразой ниже */
  }
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : null;
    throw new ApiError(res.status, detail || `Сервер ответил ошибкой (${res.status}).`);
  }
  return data;
}

const post = (path, body, signal) =>
  request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

export const api = {
  meta: () => request("/api/meta"),
  season: (year, slug, signal) => request(`/api/season/${year}/${slug}`, { signal }),
  tba: (signal) => request("/api/tba", { signal }),
  title: (id, signal) => request(`/api/title/${id}`, { signal }),
  search: (q, deep = false, signal) =>
    request(`/api/search?q=${encodeURIComponent(q)}${deep ? "&deep=true" : ""}`, { signal }),
  titles: (ids, signal) => post("/api/titles", { ids }, signal),
  related: (ids, signal) => post("/api/related", { ids }, signal),
};
