/**
 * Orchestrate board completion → Issues status `review` (MIN-261 Phase 3).
 */

import { listIssues, updateIssue } from '../../state/issues-store.ts';

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

  const updated: string[] = [];
  for (const issue of listIssues()) {
    if (
      issue.status === 'done' ||
      issue.status === 'canceled' ||
      issue.status === 'review'
    ) {
      continue;
    }
    const matchBoard =
      Boolean(plannerChatId) && issue.boardChatId?.trim() === plannerChatId;
    const issuePlan = issue.planPath?.trim().replace(/\\/g, '/');
    const matchPlan = Boolean(planPath) && Boolean(issuePlan) && issuePlan === planPath;
    if (!matchBoard && !matchPlan) continue;
    updateIssue(issue.id, { status: 'review' });
    updated.push(issue.id);
  }
  return updated;
}
