/**
 * Configurable upstream generation timeouts (~/.minnow/config.json `chat` block).
 */

import { readConfigJson } from '../config/store.js';

/** Default: abort when no SSE bytes for this long (timer resets per chunk). */
export const DEFAULT_GENERATION_IDLE_TIMEOUT_MS = 25 * 60_000;
/** Default: hard wall-clock cap for a single generation. */
export const DEFAULT_GENERATION_MAX_DURATION_MS = 60 * 60_000;

const MIN_IDLE_MS = 30_000;
const MAX_IDLE_MS = 30 * 60_000;
const MIN_MAX_MS = 60_000;
const MAX_MAX_MS = 4 * 60 * 60_000;

/**
 * @param {unknown} value
 * @returns {number}
 */
export function clampGenerationIdleTimeoutMs(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GENERATION_IDLE_TIMEOUT_MS;
  return Math.min(MAX_IDLE_MS, Math.max(MIN_IDLE_MS, Math.round(n)));
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function clampGenerationMaxDurationMs(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GENERATION_MAX_DURATION_MS;
  return Math.min(MAX_MAX_MS, Math.max(MIN_MAX_MS, Math.round(n)));
}

/**
 * @param {{ idleMs: number, maxMs: number }} timeouts
 * @param {'idle' | 'max'} kind
 * @returns {string}
 */
export function generationTimeoutMessage({ idleMs, maxMs }, kind) {
  if (kind === 'idle') {
    const min = Math.max(1, Math.round(idleMs / 60_000));
    return `The model stopped sending data for ${min} minutes. Try again, shorten context, or use a faster model.`;
  }
  const min = Math.max(1, Math.round(maxMs / 60_000));
  return `Generation reached the ${min}-minute server limit. Try again with a shorter prompt or smaller max tokens.`;
}

/**
 * @returns {Promise<{ idleMs: number, maxMs: number }>}
 */
export async function readGenerationUpstreamTimeouts() {
  const meta = await readConfigJson('config.json');
  const chat =
    meta && typeof meta === 'object' && meta.chat && typeof meta.chat === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.chat)
      : {};
  return {
    idleMs: clampGenerationIdleTimeoutMs(chat.generationIdleTimeoutMs),
    maxMs: clampGenerationMaxDurationMs(chat.generationMaxDurationMs),
  };
}
