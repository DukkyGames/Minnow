/**
 * Triage-lane identity for the Issues list.
 *
 * Status is independent: a crash can sit in the taxonomy's triage-role status
 * or anywhere else. The lane keys off origin + whether a human has reviewed it.
 */

import type { IssueCard, IssueSource } from '../types';

/** Sources that feed the Triage view until `triagedAt` is set. */
export const TRIAGE_SOURCES: readonly IssueSource[] = ['crash', 'agent', 'github'];

const TRIAGE_SOURCE_SET = new Set<string>(TRIAGE_SOURCES);

/** True when `source` is one of the auto-filed origins. */
export function isTriageSource(source: string | undefined): source is IssueSource {
  return typeof source === 'string' && TRIAGE_SOURCE_SET.has(source);
}

/**
 * Unreviewed = auto-filed origin and no review timestamp.
 *
 * User-created issues (`source: 'user'` or unset on pre-v3 cards) never enter
 * this lane, even when their status is the triage-role status.
 */
export function isUnreviewedTriageIssue(issue: Pick<IssueCard, 'source' | 'triagedAt'>): boolean {
  if (issue.triagedAt != null) return false;
  return isTriageSource(issue.source);
}
