/**
 * Inline SVG icons for the Email mail view (stroke paths, matches `.icon-svg`).
 */

const SVG_OPEN =
  '<svg class="icon-svg email-icon" viewBox="0 0 24 24" aria-hidden="true">';
const SVG_CLOSE = "</svg>";

function paths(d: string | string[]): string {
  const list = Array.isArray(d) ? d : [d];
  return list.map((line) => `<path d="${line}"/>`).join("");
}

/** Icon markup keyed by mail action affordance. */
export const EMAIL_ICONS = {
  compose: `${SVG_OPEN}${paths("M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z")}${SVG_CLOSE}`,
  reply: `${SVG_OPEN}${paths("M9 17l-5-5 5-5M4 12h10a6 6 0 0 1 6 6v1")}${SVG_CLOSE}`,
  replyAll: `${SVG_OPEN}${paths(["M9 17l-5-5 5-5", "M4 12h6a6 6 0 0 1 6 6v1", "M20 17l-5-5 5-5", "M15 12h2a6 6 0 0 0-6-6v-1"])}${SVG_CLOSE}`,
  forward: `${SVG_OPEN}${paths("M15 17l5-5-5-5M20 12H10a6 6 0 0 0-6 6v1")}${SVG_CLOSE}`,
  star: `${SVG_OPEN}${paths("M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z")}${SVG_CLOSE}`,
  starFilled: `${SVG_OPEN.replace(">", ' fill="currentColor">')}${paths("M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z")}${SVG_CLOSE}`,
  archive: `${SVG_OPEN}${paths("M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8M1 3h22v5H1zM10 12h4")}${SVG_CLOSE}`,
  trash: `${SVG_OPEN}${paths(["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6"])}${SVG_CLOSE}`,
  mail: `${SVG_OPEN}${paths(["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M22 6l-10 7L2 6"])}${SVG_CLOSE}`,
  mailOpen: `${SVG_OPEN}${paths(["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M22 6l-10 7L2 6"])}${SVG_CLOSE}`,
  attach: `${SVG_OPEN}${paths("M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48")}${SVG_CLOSE}`,
  sync: `${SVG_OPEN}${paths(["M21 12a9 9 0 1 1-2.64-6.36", "M21 3v6h-6"])}${SVG_CLOSE}`,
  search: `${SVG_OPEN}${paths(["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.35-4.35"])}${SVG_CLOSE}`,
  more: `${SVG_OPEN}${paths(["M12 12h.01", "M19 12h.01", "M5 12h.01"])}${SVG_CLOSE}`,
  chevronLeft: `${SVG_OPEN}${paths("M15 18l-6-6 6-6")}${SVG_CLOSE}`,
  chevronRight: `${SVG_OPEN}${paths("M9 18l6-6-6-6")}${SVG_CLOSE}`,
  back: `${SVG_OPEN}${paths("M19 12H5M12 19l-7-7 7-7")}${SVG_CLOSE}`,
  folder: `${SVG_OPEN}${paths("M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z")}${SVG_CLOSE}`,
  spam: `${SVG_OPEN}${paths(["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"])}${SVG_CLOSE}`,
  move: `${SVG_OPEN}${paths(["M5 9l-3 3 3 3", "M9 12h12", "M19 15l3-3-3-3", "M15 12H3"])}${SVG_CLOSE}`,
} as const;
