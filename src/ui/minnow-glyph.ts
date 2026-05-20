/**
 * Inline Minnow fish glyph (white via currentColor on accent backgrounds).
 */

const BODY =
  'M 16 50 C 26 36, 44 32, 56 42 L 69 50 L 56 58 C 44 68, 26 64, 16 50 Z';
const TAIL = 'M 69 50 L 84 40 L 81 50 L 84 60 Z';

/** Header logo mark (fits 28×28 container). */
export const MINNOW_GLYPH_HEADER_HTML = `<svg class="minnow-glyph icon-svg" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" d="${BODY}"/><path fill="currentColor" d="${TAIL}"/></svg>`;

/** Empty chat state icon (larger). */
export const MINNOW_GLYPH_EMPTY_HTML = `<svg class="minnow-glyph icon-svg" width="32" height="32" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" d="${BODY}"/><path fill="currentColor" d="${TAIL}"/></svg>`;
