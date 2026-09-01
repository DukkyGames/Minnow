/**
 * Learn how far the character-based token estimate sits from a model's real
 * tokenizer from provider overflow numbers.
 */

export function recordContextEstimateBias(
  modelId: string,
  requestTokens: number,
  estimatedMessageTokens: number,
  reservedTokens?: number,
): void;

/** Learned real-per-estimated ratio for a model, or null when never measured. */
export function contextEstimateBias(modelId: string): number | null;

/**
 * Message-estimate ceiling for a model whose bias has been measured — null when
 * it has not, leaving the caller on the ordinary margin-and-reserve budget.
 */
export function contextCalibratedMessageLimit(
  modelId: string,
  modelLimit: number | null,
  safetyMargin: number,
  reservedTokens?: number,
): number | null;

/** Test seam — calibration is process-lifetime state. */
export function resetContextEstimateCalibrationForTests(): void;
