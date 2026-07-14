/**
 * Tri-state thinking mode presets (inherit / on / off) and resolved on-off for sends.
 */

/** Per-entity override: inherit merges from parent layer; on/off are explicit. */
export type ThinkingTriState = 'inherit' | 'on' | 'off';

/** Binary mode applied to completion requests after resolution. */
export type ThinkingResolvedMode = 'on' | 'off';

/** Global default in config.json (no inherit — always on or off). */
export type ThinkingGlobalDefault = ThinkingResolvedMode;

const TRI_STATES = new Set<ThinkingTriState>(['inherit', 'on', 'off']);
const RESOLVED = new Set<ThinkingResolvedMode>(['on', 'off']);

export function isThinkingTriState(value: unknown): value is ThinkingTriState {
  return typeof value === 'string' && TRI_STATES.has(value as ThinkingTriState);
}

export function isThinkingResolvedMode(value: unknown): value is ThinkingResolvedMode {
  return typeof value === 'string' && RESOLVED.has(value as ThinkingResolvedMode);
}

export function normalizeThinkingTriState(
  value: unknown,
  fallback: ThinkingTriState = 'inherit',
): ThinkingTriState {
  return isThinkingTriState(value) ? value : fallback;
}

export function normalizeThinkingGlobalDefault(
  value: unknown,
  fallback: ThinkingGlobalDefault = 'on',
): ThinkingGlobalDefault {
  return isThinkingResolvedMode(value) ? value : fallback;
}

/** Merge tri-state layers: later non-inherit wins; inherit keeps prior resolved value. */
export function mergeThinkingTriState(
  base: ThinkingResolvedMode,
  ...layers: Array<ThinkingTriState | undefined | null>
): ThinkingResolvedMode {
  let resolved = base;
  for (const layer of layers) {
    if (layer === 'on' || layer === 'off') {
      resolved = layer;
    }
  }
  return resolved;
}

/** Min/max for per-thinking-session token budgets (approximate chars ÷ 4). */
export const THINKING_BUDGET_MIN = 10;
/** Default per-request thinking budget for llama.cpp when mode is on and no tier sets a budget. */
export const DEFAULT_LLAMA_THINKING_BUDGET_TOKENS = 8192;
export const THINKING_BUDGET_MAX = 200_000;

/**
 * Coerce thinking budget tokens: `null` = inherit/off, `0` = explicitly off,
 * positive values clamped to [10, 200_000].
 */
export function clampThinkingBudgetTokens(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 0) return null;
  if (rounded === 0) return 0;
  return Math.min(THINKING_BUDGET_MAX, Math.max(THINKING_BUDGET_MIN, rounded));
}
