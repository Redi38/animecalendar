// Иконки интерфейса: SVG-строки для innerHTML (статичная разметка, данных API здесь нет).
// Размер, толщина линии и заливка задаются параметрами, а не правкой готовой строки.

const svg = (body, { size = 24, cls = "", stroke = 2, fill = "none" } = {}) =>
  `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// Карточка тайтла.
const BOOKMARK_PATH = '<path d="M6 3h12v18l-6-4.5L6 21z"/>';
export const ICON_EYE = svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', { size: 16 });
export const ICON_CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', { size: 16, stroke: 2.6 });
export const ICON_BOOKMARK = svg(BOOKMARK_PATH, { size: 16 });
export const ICON_BOOKMARK_ON = svg(BOOKMARK_PATH, { size: 16, fill: "currentColor" });

// Рулетка.
const SPEAKER = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>';
export const ICON_VOLUME = svg(`${SPEAKER}<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>`);
export const ICON_MUTED = svg(`${SPEAKER}<line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`);
export const ICON_CHEVRON = svg('<polyline points="6 9 12 15 18 9"></polyline>', { size: 16, cls: "wheel-dock-chevron" });
export const ICON_TRASH = svg(
  '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>',
  { size: 16 },
);
