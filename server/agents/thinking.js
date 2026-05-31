/**
 * Shared thinking mode normalization for work-agents and sub-agents APIs.
 */

const TRI_STATES = new Set(['inherit', 'on', 'off']);
const GLOBAL_MODES = new Set(['on', 'off']);

/**
 * @param {unknown} value
 * @returns {'inherit' | 'on' | 'off' | null}
 */
export function normalizeThinkingTriState(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && TRI_STATES.has(value)) return value;
  return null;
}

/**
 * @param {unknown} value
 * @returns {'on' | 'off' | null}
 */
export function normalizeThinkingGlobalDefault(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && GLOBAL_MODES.has(value)) return value;
  return null;
}
