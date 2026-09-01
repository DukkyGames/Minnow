import type { Attempt, RunState } from './types';

export function attemptHistoryRecord(attempt: Attempt): Record<string, unknown>;

export function bundleAbandonmentEvidence(
  run: RunState,
  decision: { evidence?: Record<string, unknown> | null },
): Record<string, unknown>;
