/**
 * Orchestrate plan completion helpers (supervisor gating, resume, completion copy).
 */

import type { Chat, OrchestrateBoardState } from '../../types.ts';

/** True when the board has at least one task and every task is `complete`. */
export function isOrchestratePlanComplete(board: OrchestrateBoardState): boolean {
  const tasks = board.tasks;
  return tasks.length > 0 && tasks.every((t) => t.status === 'complete');
}

/** True when orchestration still has work that can be resumed. */
export function hasIncompleteOrchestrateWork(board: OrchestrateBoardState): boolean {
  return board.tasks.some((t) => t.status !== 'complete');
}

/** Manual/auto resume is allowed only while incomplete work remains. */
export function canOrchestrateResume(board: OrchestrateBoardState): boolean {
  return hasIncompleteOrchestrateWork(board);
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
    'All board tasks are finished. Auto-resume is off for this chat.',
    '',
    '**Next steps:** review results in the board, start a new chat, or export/share the plan if needed.',
  ].join('\n');
}

export const ORCHESTRATE_PLAN_COMPLETE_RESUME_HINT =
  'Plan complete — all board tasks are finished. Start a new chat or review results in the board.';
