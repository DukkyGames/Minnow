import type { IssueCard } from '../../types';

export function issueHasDetails(issue: Pick<IssueCard, 'description' | 'notes'>): boolean {
  return Boolean(issue.description?.trim() || issue.notes?.trim());
}

/** True when there is any prose to expand (issues always have a title in practice). */
export function canExpandIssueDraft(
  issue: Pick<IssueCard, 'title' | 'description' | 'notes'>,
): boolean {
  return Boolean(issue.title?.trim() || issue.description?.trim() || issue.notes?.trim());
}
