/**
 * Orchestrate plan completion helpers (manual board — completion message only).
 */

import type { Chat, OrchestrateBoardState } from '../../types.ts';

function isTerminalStatus(status: string): boolean {
  return status === 'complete' || status === 'quarantined';
}

/**
 * True when the board has at least one task and every task has reached a terminal
 * state (`complete` or `quarantined`). A total cascade where every task is
 * quarantined (zero complete) still counts as done so end-of-run report and
 * notification fire (GAP-1).
 */
export function isOrchestratePlanComplete(board: OrchestrateBoardState): boolean {
  const tasks = board.tasks;
  return tasks.length > 0 && tasks.every((t) => isTerminalStatus(t.status));
}

/** True when all tasks are terminal and the final integration test passed. */
export function isOrchestrateBoardFinished(board: OrchestrateBoardState): boolean {
  return isOrchestratePlanComplete(board) && board.finalTest?.status === 'passed';
}

/** Task statuses the user (or AFK) can reset back to `planned` for another run. */
export function isBoardTaskRecoverableStatus(status: string): boolean {
  return status === 'quarantined' || status === 'failed' || status === 'blocked';
}

export function boardHasRecoverableTasks(board: OrchestrateBoardState): boolean {
  return board.tasks.some((t) => isBoardTaskRecoverableStatus(t.status));
}

/** Every task is `complete` but the full-board integration test recorded `failed`. */
export function isOrchestrateFinalTestFailedWithAllTasksComplete(
  board: OrchestrateBoardState,
): boolean {
  if (board.finalTest?.status !== 'failed') return false;
  return board.tasks.length > 0 && board.tasks.every((t) => t.status === 'complete');
}

/** Finish dashboard is available (passed final test, all-quarantined blocked, or final-test fail). */
export function canAccessOrchestrateFinishDashboard(board: OrchestrateBoardState): boolean {
  if (isOrchestrateBoardFinished(board)) return true;
  if (board.completionShownAt == null) return false;
  if (board.terminalBlocked === true) return true;
  return isOrchestrateFinalTestFailedWithAllTasksComplete(board);
}

/** True when the finish dashboard should replace the kanban (MIN-208). */
export function shouldShowOrchestrateFinishDashboard(board: OrchestrateBoardState): boolean {
  return canAccessOrchestrateFinishDashboard(board) && board.dashboardDismissed !== true;
}

/** True when orchestration still has non-terminal tasks. */
export function hasIncompleteOrchestrateWork(board: OrchestrateBoardState): boolean {
  return board.tasks.some((t) => !isTerminalStatus(t.status));
}

function shortPlanLabel(planPath: string): string {
  const trimmed = planPath.trim();
  if (!trimmed) return 'Orchestrate plan';
  const base = trimmed.split('/').pop() ?? trimmed;
  return base.replace(/\.md$/i, '') || trimmed;
}

function formatElapsedMs(startedAt: number, endedAt: number): string {
  const ms = Math.max(0, endedAt - startedAt);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const mRem = min % 60;
  return mRem > 0 ? `${hr}h ${mRem}m` : `${hr}h`;
}

/**
 * User-facing summary when every board task is complete (chat + board header).
 */
export function buildOrchestrateCompletionMessage(
  chat: Chat,
  board: OrchestrateBoardState,
  endedAtMs: number,
): string {
  const planPath = chat.orchestratePlanPath?.trim() || board.planPath?.trim() || '';
  const planName = shortPlanLabel(planPath);
  const total = board.tasks.length;
  const completeCount = board.tasks.filter((t) => t.status === 'complete').length;
  const quarantinedCount = board.tasks.filter((t) => t.status === 'quarantined').length;
  const elapsed = formatElapsedMs(board.startedAt, endedAtMs);

  const allQuarantined = completeCount === 0 && quarantinedCount > 0;
  const finalTestFailed =
    board.finalTest?.status === 'failed' && completeCount === total && total > 0;
  const headline = allQuarantined
    ? `**Orchestrate plan blocked** — ${planName}`
    : finalTestFailed
      ? `**Orchestrate plan blocked** — final integration test failed — ${planName}`
      : `**Orchestrate plan complete** — ${planName}`;

  const lines = [
    headline,
    '',
    `- **Tasks:** ${completeCount}/${total} complete`,
    ...(quarantinedCount > 0 ? [`- **Quarantined:** ${quarantinedCount}`] : []),
    `- **Elapsed:** ${elapsed}`,
    '',
    allQuarantined
      ? `All remaining tasks are quarantined (${quarantinedCount}). Requeue cards after addressing resolution steps.`
      : finalTestFailed
        ? 'All tasks merged, but the final integration test failed. Use **Rerun failed tasks** on the finish dashboard or re-run the final test from the board header.'
        : 'All board tasks are finished. Move any remaining cards or start a new chat when ready.',
    '',
    allQuarantined
      ? '**Next steps:** review quarantined tasks on the board, fix blockers, then Requeue to retry.'
      : finalTestFailed
        ? '**Next steps:** open the finish dashboard, rerun failed work, or fix issues manually and re-run the final integration test.'
        : '**Next steps:** review results in the board, open task chats, or export/share the plan if needed.',
  ];

  const issues = board.unresolvedIssues;
  if (issues && issues.length > 0) {
    lines.push('', `**Unresolved / quarantined (${issues.length})**`, '');
    for (const issue of issues) {
      lines.push(`- **${issue.title}** (${issue.category}) — ${issue.summary}`);
      for (const step of issue.resolutionSteps) {
        lines.push(`  - ${step}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Hidden user seed for the one plan-complete wrap-up LLM turn.
 */
export function buildOrchestratePlanCompleteWrapUpSeed(
  _chat: Chat,
  board: OrchestrateBoardState,
): string {
  const completed = board.tasks.filter((t) => t.status === 'complete');
  const quarantined = board.tasks.filter((t) => t.status === 'quarantined');

  const lines = [
    'The Orchestrate board run has finished. Write a concise final wrap-up for the user.',
    '',
    'Cover:',
    '- Completed tasks (what shipped)',
    '- Quarantined or blocked tasks with root causes',
    '- Unresolved issues and their resolution steps',
    '- Suggested next steps',
    '',
    `Completed (${completed.length}):`,
    ...(completed.length > 0
      ? completed.map((t) => `- \`${t.id}\` — ${t.title}`)
      : ['- (none)']),
    '',
    `Quarantined (${quarantined.length}):`,
    ...(quarantined.length > 0
      ? quarantined.map((t) => {
          const reason = t.quarantine?.summary?.trim() || t.error?.trim() || '(no summary)';
          return `- \`${t.id}\` — ${t.title}: ${reason}`;
        })
      : ['- (none)']),
  ];

  const issues = board.unresolvedIssues;
  if (issues && issues.length > 0) {
    lines.push('', `Unresolved issues (${issues.length}):`);
    for (const issue of issues) {
      lines.push(`- **${issue.title}** (${issue.category}) — ${issue.summary}`);
      for (const step of issue.resolutionSteps) {
        lines.push(`  - ${step}`);
      }
    }
  }

  lines.push(
    '',
    'Use `board_get_state` if you need the full board snapshot. Do not ask the user questions — summarize what happened and what to do next.',
  );

  return lines.join('\n');
}
