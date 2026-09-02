/**
 * Resolve provider + model for one attempt.
 */
export function resolveAttemptModel(override?: {
  providerId?: string;
  id?: string;
  reasoning?: string | null;
} | null): Promise<{ providerId: string; id: string }>;
