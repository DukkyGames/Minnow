/**
 * Resolve provider + model for one attempt.
 */
export function resolveAttemptModel(override?: {
  providerId?: string;
  id?: string;
  reasoning?: string | null;
} | null): Promise<{ providerId: string; id: string }>;

/**
 * Complete an explicit pair without Autopilot / active-chat fallback.
 */
export function completeModelPair(
  providerId?: unknown,
  modelId?: unknown,
): Promise<{ providerId: string; id: string } | null>;
