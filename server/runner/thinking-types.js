const TRI_STATES = /* @__PURE__ */ new Set(["inherit", "on", "off"]);
const RESOLVED = /* @__PURE__ */ new Set(["on", "off"]);
function isThinkingTriState(value) {
  return typeof value === "string" && TRI_STATES.has(value);
}
function isThinkingResolvedMode(value) {
  return typeof value === "string" && RESOLVED.has(value);
}
function normalizeThinkingTriState(value, fallback = "inherit") {
  return isThinkingTriState(value) ? value : fallback;
}
function normalizeThinkingGlobalDefault(value, fallback = "on") {
  return isThinkingResolvedMode(value) ? value : fallback;
}
function mergeThinkingTriState(base, ...layers) {
  let resolved = base;
  for (const layer of layers) {
    if (layer === "on" || layer === "off") {
      resolved = layer;
    }
  }
  return resolved;
}
const THINKING_BUDGET_MIN = 10;
const DEFAULT_LLAMA_THINKING_BUDGET_TOKENS = 8192;
const THINKING_BUDGET_MAX = 2e5;
function clampThinkingBudgetTokens(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 0) return null;
  if (rounded === 0) return 0;
  return Math.min(THINKING_BUDGET_MAX, Math.max(THINKING_BUDGET_MIN, rounded));
}
export {
  DEFAULT_LLAMA_THINKING_BUDGET_TOKENS,
  THINKING_BUDGET_MAX,
  THINKING_BUDGET_MIN,
  clampThinkingBudgetTokens,
  isThinkingResolvedMode,
  isThinkingTriState,
  mergeThinkingTriState,
  normalizeThinkingGlobalDefault,
  normalizeThinkingTriState
};
