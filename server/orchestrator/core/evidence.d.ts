import type { Attempt, Evidence, TaskState } from './types';

/** Cap on one attempt's unified-diff text. History length is never capped. */
export const MAX_DIFF_CHARS: number;

export function capDiffText(text: unknown): {
  text: string;
  truncated: boolean;
  originalLength?: number;
};

export function capDiffPayload(diff: unknown): Record<string, unknown> | string | null;

export function attemptHistoryRecord(attempt: Attempt | Record<string, unknown>): Record<string, unknown>;

export function bundleAbandonmentEvidence(
  task: Pick<TaskState, 'attempts'> | { attempts?: readonly Attempt[] },
  decision: { evidence?: Evidence | null },
): Evidence;

export function abandonmentEvidenceIsComplete(evidence: unknown): boolean;

export function queryAbandonments(
  events: Iterable<unknown>,
): Array<{ taskId: string; reason: unknown; evidence: Evidence }>;
