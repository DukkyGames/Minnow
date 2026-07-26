/**
 * Orchestrate board completion → Issues status with review role (MIN-261 Phase 3).
 */

import {
  isClosedStatus,
  isReviewStatus,
  statusIdForRole,
} from '../../issues/taxonomy.ts';
import { listIssues, updateIssue } from '../../state/issues-store.ts';
import { getIssuesTaxonomySync } from '../../state/issues-taxonomy-store.ts';

/**
 * When an Orchestrate board finishes, move linked issues to review.
 * Matches by boardChatId (planner chat) and/or planPath.
 */
export function markIssuesReviewForBoardComplete(input: {
  plannerChatId?: string;
  planPath?: string;
}): string[] {
  const plannerChatId = input.plannerChatId?.trim();
  const planPath = input.planPath?.trim().replace(/\\/g, '/');
  if (!plannerChatId && !planPath) return [];

  const taxonomy = getIssuesTaxonomySync();
  const reviewStatusId = statusIdForRole(taxonomy, 'review');
  if (!reviewStatusId) return [];

  const updated: string[] = [];
  for (const issue of listIssues()) {
    if (
      isClosedStatus(taxonomy, issue.status) ||
      isReviewStatus(taxonomy, issue.status)
    ) {
      continue;
    }
    const matchBoard =
      Boolean(plannerChatId) && issue.boardChatId?.trim() === plannerChatId;
    const issuePlan = issue.planPath?.trim().replace(/\\/g, '/');
    const matchPlan = Boolean(planPath) && Boolean(issuePlan) && issuePlan === planPath;
    if (!matchBoard && !matchPlan) continue;
    updateIssue(issue.id, { status: reviewStatusId });
    updated.push(issue.id);
  }
  return updated;
}
