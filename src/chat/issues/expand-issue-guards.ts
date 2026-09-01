/**
 * Tiny predicates for the Issues sparkles expander (MIN-635).
 *
 * Kept free of the prompt/parser module so Issues page paint can gate the
 * sparkles control without pulling expand prompts into the store chunk.
 */

import type { IssueCard } from '../../types';

/**
 * True when the card already has body text to improve rather than invent.
 * Notes count: a stub description often lives there on triage captures.
 */
export function issueHasDetails(issue: Pick<IssueCard, 'description' | 'notes'>): boolean {
  return Boolean(issue.description?.trim() || issue.notes?.trim());
}

/** True when there is any prose to expand (issues always have a title in practice). */
export function canExpandIssueDraft(
  issue: Pick<IssueCard, 'title' | 'description' | 'notes'>,
): boolean {
  return Boolean(issue.title?.trim() || issue.description?.trim() || issue.notes?.trim());
}
