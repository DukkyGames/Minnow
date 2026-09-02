const observedBias = new Map();

const MIN_BIAS = 1;
const MAX_BIAS = 4;

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
  const prev = observedBias.get(id);
  if (prev != null && prev >= next) return;
  observedBias.set(id, next);
}

export function contextEstimateBias(modelId) {
  return observedBias.get(String(modelId ?? '').trim()) ?? null;
}

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

export function resetContextEstimateCalibrationForTests() {
  observedBias.clear();
}
