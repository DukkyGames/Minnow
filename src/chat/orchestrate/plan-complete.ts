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
  const elapsed = formatElapsedMs(board.startedAt, endedAtMs);

  return [
    `**Orchestrate plan complete** — ${planName}`,
    '',
    `- **Tasks:** ${total}/${total} complete`,
    `- **Elapsed:** ${elapsed}`,
    '',
    'All board tasks are finished. Move any remaining cards or start a new chat when ready.',
    '',
    '**Next steps:** review results in the board, open task chats, or export/share the plan if needed.',
  ].join('\n');
}
