import type { Action, PolicyRow } from './types';

export const POLICY_TABLE: readonly PolicyRow[];

export function decide(input: {
  outcome: string;
  attemptCount: number;
  summary?: string | null;
  evidence?: Record<string, unknown> | null;
}): Action;

export function formatPolicyTable(): string;
