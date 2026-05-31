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
