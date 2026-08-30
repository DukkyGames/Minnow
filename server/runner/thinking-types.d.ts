/**
 * Tri-state thinking mode presets (inherit / on / off) and resolved on-off for sends.
 */
/** Per-entity override: inherit merges from parent layer; on/off are explicit. */
export type ThinkingTriState = 'inherit' | 'on' | 'off';
/** Binary mode applied to completion requests after resolution. */
export type ThinkingResolvedMode = 'on' | 'off';
/** Global default in config.json (no inherit — always on or off). */
export type ThinkingGlobalDefault = ThinkingResolvedMode;
export declare function isThinkingTriState(value: unknown): value is ThinkingTriState;
export declare function isThinkingResolvedMode(value: unknown): value is ThinkingResolvedMode;
export declare function normalizeThinkingTriState(value: unknown, fallback?: ThinkingTriState): ThinkingTriState;
export declare function normalizeThinkingGlobalDefault(value: unknown, fallback?: ThinkingGlobalDefault): ThinkingGlobalDefault;
/** Merge tri-state layers: later non-inherit wins; inherit keeps prior resolved value. */
export declare function mergeThinkingTriState(base: ThinkingResolvedMode, ...layers: Array<ThinkingTriState | undefined | null>): ThinkingResolvedMode;
/** Min/max for per-thinking-session token budgets (approximate chars ÷ 4). */
export declare const THINKING_BUDGET_MIN = 10;
/** Default per-request thinking budget for llama.cpp when mode is on and no tier sets a budget. */
export declare const DEFAULT_LLAMA_THINKING_BUDGET_TOKENS = 8192;
export declare const THINKING_BUDGET_MAX = 200000;
/**
 * Coerce thinking budget tokens: `null` = inherit/off, `0` = explicitly off,
 * positive values clamped to [10, 200_000].
 */
export declare function clampThinkingBudgetTokens(value: unknown): number | null;
