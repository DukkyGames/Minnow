/**
 * Resolve provider + model for one attempt. Throws when nothing is bound.
 * Pass `override` from tests (or a future journaled board model).
 */
export function resolveAttemptModel(override?: {
  providerId?: string;
  id?: string;
  reasoning?: string | null;
} | null): Promise<{ providerId: string; id: string }>;
