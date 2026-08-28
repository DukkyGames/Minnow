import type { Action, Evidence, PolicyOutcome, PolicyRow, Role, SeedKind } from './types';

/**
 * The recovery policy, as data rather than control flow.
 *
 * Rows are matched top to bottom; the first whose role, outcome, and attempt
 * bound all match wins. `under: n` applies while `attemptCount < n`;
 * `under: null` is that role-and-outcome's fallback.
 */
export const POLICY_TABLE: readonly PolicyRow[];

/** What happens next. Total over every role, outcome, and attempt count. */
export function decide(input: {
  role: Role | string;
  outcome: PolicyOutcome | string;
  attemptCount: number;
  summary?: string | null;
  evidence?: Evidence | null;
}): Action;

/** Render the table as markdown, so tests compare rather than restate. */
export function formatPolicyTable(): string;

export type { Action, PolicyOutcome, PolicyRow, SeedKind };
