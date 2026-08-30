/**
 * Pure helpers for identifying a pull request to review.
 * No I/O — unit-testable without forge or the issues store.
 */

import type { IssueCard } from '../../types.ts';
import type { PullRequestSummary } from '../../state/forge-api.ts';

/** Stable review identity: `owner/name#123`. */
export function prReviewKey(repo: string, number: number): string {
  return `${repo.trim()}#${number}`;
}

/** Open PR whose head branch matches the current checkout. */
export function matchPrForBranch(
  prs: readonly PullRequestSummary[],
  branch: string,
): PullRequestSummary | null {
  const wanted = branch.trim();
  if (!wanted) return null;
  return prs.find((pr) => pr.state === 'open' && pr.headRef === wanted) ?? null;
}

/** PR number already stored on the issue, if any. */
export interface IssuePrRef {
  number: number;
  url?: string;
}

/**
 * Prefer an explicit git-link chip, then the agent slot.
 * `gitLinks` is what the user (or Create PR) wrote; `agent.prNumber` is what
 * the board watcher stamps. Neither is inferred from the branch here.
 */
export function resolveIssuePrRef(issue: Pick<IssueCard, 'gitLinks' | 'agent'>): IssuePrRef | null {
  const linked = (issue.gitLinks ?? []).find((link) => link.kind === 'pr');
  if (linked?.ref?.trim()) {
    const number = Number.parseInt(linked.ref.trim(), 10);
    if (Number.isFinite(number) && number > 0) {
      return {
        number,
        url: linked.url?.trim() || undefined,
      };
    }
  }

  const fromAgent = issue.agent?.prNumber;
  if (typeof fromAgent === 'number' && Number.isFinite(fromAgent) && fromAgent > 0) {
    return {
      number: fromAgent,
      url: issue.agent?.prUrl?.trim() || undefined,
    };
  }

  return null;
}
