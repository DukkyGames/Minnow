/**
 * Learn how far the character-based token estimate sits from a model's real
 * tokenizer, using the only ground truth available for free: the numbers a
 * provider reports when it rejects an oversized request.
 *
 * Shared runner copy — `server/runner` must not import `src/`. The SPA re-exports
 * this module from `src/chat/context/estimate-calibration.ts`.
 */

/** Ratio of real prompt tokens to estimated message tokens, keyed by model id. */
const observedBias = new Map();

/**
 * Clamp range for a learned ratio. Below 1 the estimate was already high enough
 * and needs no correction; above 4 the sample is more likely a parse artifact
 * than a tokenizer, and trusting it would shrink the window to nothing.
 */
const MIN_BIAS = 1;
const MAX_BIAS = 4;

/**
 * Record a provider-measured request size against what we estimated for it.
 *
 * `reservedTokens` is subtracted first so the ratio describes the *messages*
 * only. The reserve is already handled separately by the budget; folding it in
 * here too would shrink the window twice for the same tool schemas.
 */
export function recordContextEstimateBias(
  modelId,
  requestTokens,
  estimatedMessageTokens,
  reservedTokens = 0,
) {
  const id = String(modelId ?? '').trim();
  if (!id) return;
  if (!Number.isFinite(requestTokens) || !Number.isFinite(estimatedMessageTokens)) return;
  if (requestTokens <= 0 || estimatedMessageTokens <= 0) return;
  const messageTokens = requestTokens - Math.max(0, reservedTokens);
  if (messageTokens <= 0) return;
  const ratio = messageTokens / estimatedMessageTokens;
  if (!Number.isFinite(ratio) || ratio <= MIN_BIAS) return;
  const next = Math.min(MAX_BIAS, ratio);
  // Keep the worst gap seen: a later, lighter turn must not relax a ceiling
  // that a heavier one proved necessary.
  const prev = observedBias.get(id);
  if (prev != null && prev >= next) return;
  observedBias.set(id, next);
}

/** Learned real-per-estimated ratio for a model, or null when never measured. */
export function contextEstimateBias(modelId) {
  return observedBias.get(String(modelId ?? '').trim()) ?? null;
}

/**
 * Message-estimate ceiling for a model whose bias has been measured — null when
 * it has not, leaving the caller on the ordinary margin-and-reserve budget.
 */
export function contextCalibratedMessageLimit(
  modelId,
  modelLimit,
  safetyMargin,
  reservedTokens = 0,
) {
  if (modelLimit == null || !Number.isFinite(modelLimit) || modelLimit <= 0) return null;
  const bias = contextEstimateBias(modelId);
  if (bias == null) return null;
  const forMessages = modelLimit * safetyMargin - Math.max(0, reservedTokens);
  return Math.max(1, Math.floor(forMessages / bias));
}

/** Test seam — calibration is process-lifetime state. */
export function resetContextEstimateCalibrationForTests() {
  observedBias.clear();
}
