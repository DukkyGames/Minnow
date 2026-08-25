/**
 * UI side effects when an Orchestrate plan reaches all-complete (chat + toast).
 */

import {
  buildOrchestrateCompletionMessage,
  buildOrchestratePlanCompleteWrapUpSeed,
  isOrchestrateFinalTestFailedWithAllTasksComplete,
  isOrchestratePlanComplete,
} from './plan-complete.ts';
import { buildDeterministicFinishReport } from './finish-stats.ts';
import {
  enrichFinishReportWithRecommendations,
  enrichFinishReportWithRunInstructions,
} from './finish-recommendations.ts';
import { reportBackgroundError } from '../../boot/report-background-error.ts';
import { isChatStreaming, subscribeChatStreamEnd } from '../../chat/streaming-state.ts';
import { isDomAvailable } from '../../lib/dom-available.ts';
import { emitBoardChange } from '../../state/orchestrate-board-events.ts';
import {
  logBoardTerminal,
  logCompletionNotification,
  logPlannerReport,
} from '../../state/orchestrate-board-store.ts';
import {
  findGroupById,
  getPlannerChatForGroup,
} from '../../state/chat-groups.ts';
import {
  findChatById,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from '../../state/sessions.ts';
import type { Chat } from '../../types.ts';

type WrapUpTurnFn = (planner: Chat, seed: string) => Promise<void>;

let wrapUpTurnHook: WrapUpTurnFn | null = null;
let wrapUpStreamEndUnsubscribe: (() => void) | null = null;

/** Tests: capture the plan-complete wrap-up turn without running the chat loop. */
export function setOrchestratePlanCompleteWrapUpHook(fn: WrapUpTurnFn | null): void {
  wrapUpTurnHook = fn;
}

/** Test reset for plan-complete UI hooks. */
export function resetOrchestratePlanCompleteUiForTests(): void {
  wrapUpTurnHook = null;
  wrapUpStreamEndUnsubscribe?.();
  wrapUpStreamEndUnsubscribe = null;
}

function ensureWrapUpStreamEndSubscription(): void {
  if (wrapUpStreamEndUnsubscribe) return;
  wrapUpStreamEndUnsubscribe = subscribeChatStreamEnd((endedChatId) => {
    if (!sessionState) return;
    for (const group of sessionState.groups ?? []) {
      const board = group.orchestrateBoard;
      const planner = getPlannerChatForGroup(group);
      if (!board || !planner || planner.id !== endedChatId || !board.wrapUpPending) continue;
      board.wrapUpPending = false;
      emitBoardChange(group.id);
      void firePlanCompleteWrapUpTurn(planner, board, { afterStreamEnd: true }).catch((err) =>
        reportBackgroundError('orchestrate-plan-complete-wrap-up-retry', err),
      );
      return;
    }
  });
}

function showPlanCompleteToast(message: string): void {
  if (!isDomAvailable()) return;
  const el = document.createElement('div');
  el.className = 'orchestrate-watchdog-toast orchestrate-watchdog-toast--complete';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('orchestrate-watchdog-toast--visible'));
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    el.classList.remove('orchestrate-watchdog-toast--visible');
    window.setTimeout(() => el.remove(), 300);
  }, 6000);
}

async function isPlannerModelResolvable(planner: Chat): Promise<{ ok: boolean; modelId?: string }> {
  if (planner.modelId?.trim()) return { ok: true, modelId: planner.modelId.trim() };
  const { resolvePlannerModelBinding } = await import('./finish-recommendations.ts');
  const { modelId } = resolvePlannerModelBinding(planner);
  if (modelId?.trim()) return { ok: true, modelId: modelId.trim() };
  return { ok: false };
}

function resolveBoardGroupId(board: import('../../types.ts').OrchestrateBoardState): string | undefined {
  if (!sessionState) return undefined;
  for (const group of sessionState.groups ?? []) {
    if (group.orchestrateBoard === board) return group.id;
  }
  return undefined;
}

async function firePlanCompleteWrapUpTurn(
  planner: Chat,
  board: import('../../types.ts').OrchestrateBoardState,
  opts?: { afterStreamEnd?: boolean },
): Promise<void> {
  if (!opts?.afterStreamEnd && isChatStreaming(planner.id)) {
    board.wrapUpPending = true;
    ensureWrapUpStreamEndSubscription();
    const groupId = resolveBoardGroupId(board);
    if (groupId) emitBoardChange(groupId);
    return;
  }

  const resolved = await isPlannerModelResolvable(planner);
  if (!resolved.ok) {
    board.wrapUpPending = true;
    ensureWrapUpStreamEndSubscription();
    return;
  }

  board.wrapUpPending = false;
  const plannerForWrapUp = planner;
  if (!plannerForWrapUp.modelId?.trim() && resolved.modelId) {
    plannerForWrapUp.modelId = resolved.modelId;
  }

  const seed = buildOrchestratePlanCompleteWrapUpSeed(plannerForWrapUp, board);
  const runWrapUp =
    wrapUpTurnHook ??
    (async (chat, message) => {
      const { resumeParentChatWithMessage } = await import('../../tools/loop.ts');
      await resumeParentChatWithMessage(chat, message, { suppressUserEcho: true });
    });

  await runWrapUp(plannerForWrapUp, seed);
}

/**
 * Surface completion once per board when every task is complete.
 */
export async function maybeEmitOrchestratePlanComplete(groupId: string): Promise<void> {
  const group = findGroupById(groupId);
  const board = group?.orchestrateBoard;
  const planner = group ? getPlannerChatForGroup(group) : undefined;
  if (!group || !board || !planner || !isOrchestratePlanComplete(board)) return;
  // Emit when the final test passed, when all tasks are quarantined (no final test), or when
  // every task is complete but the final integration test failed (blocked finish report).
  const hasAnyComplete = board.tasks.some((t) => t.status === 'complete');
  const finalFailedAllComplete = isOrchestrateFinalTestFailedWithAllTasksComplete(board);
  if (hasAnyComplete && board.finalTest?.status !== 'passed' && !finalFailedAllComplete) {
    return;
  }

  if (board.completionShownAt != null) return;
  board.completionShownAt = Date.now();
  if (!board.finishReport?.trim()) {
    board.finishReport = buildDeterministicFinishReport(planner, board);
  } else if (!board.finishReport.includes('## Completed tasks')) {
    board.finishReport = buildDeterministicFinishReport(planner, board);
  }
  const allQuarantined =
    board.tasks.length > 0 &&
    board.tasks.every((t) => t.status === 'quarantined');
  const blocked = allQuarantined || finalFailedAllComplete;
  logBoardTerminal(
    group,
    blocked ? 'blocked' : 'passed',
    allQuarantined
      ? 'all tasks quarantined'
      : finalFailedAllComplete
        ? 'final integration failed'
        : 'final integration passed',
  );
  logPlannerReport(
    group,
    `${group.id}:completion-report`,
    blocked ? 'Plan blocked' : 'Plan complete',
  );
  logCompletionNotification(
    group,
    `${group.id}:completion-notification`,
    blocked ? 'blocked' : 'passed',
  );
  emitBoardChange(groupId);

  const text = buildOrchestrateCompletionMessage(planner, board, board.completionShownAt);
  planner.history.push({ role: 'assistant', content: text });
  touchChat(planner);
  scheduleSaveSessions();

  // Unit tests skip generation / toast / issues — those keep Node alive.
  // Tests that need the wrap-up turn install `setOrchestratePlanCompleteWrapUpHook`.
  if (typeof process !== 'undefined' && process.env?.MINNOW_TEST === '1') {
    if (wrapUpTurnHook) {
      void firePlanCompleteWrapUpTurn(planner, board).catch((err) =>
        reportBackgroundError('orchestrate-plan-complete-wrap-up', err),
      );
    }
    return;
  }

  void enrichFinishReportWithRecommendations(groupId, planner, board);
  void enrichFinishReportWithRunInstructions(groupId, planner, board);

  if (isDomAvailable()) {
    const activeId = sessionState?.activeId;
    const active = activeId ? findChatById(activeId) : undefined;
    if (active && (active.id === planner.id || active.boardGroupId === groupId)) {
      const { renderChatFromHistory } = await import('../../ui/messages.ts');
      renderChatFromHistory(active);
    }
  }
  showPlanCompleteToast(
    blocked ? 'Orchestrate plan blocked' : 'Orchestrate plan complete',
  );

  // Issues app: board finish → linked issue status `review` (MIN-261 Phase 3).
  const boardPlanPath =
    planner.orchestratePlanPath?.trim() || board.planPath?.trim() || '';
  void import('../issues/board-review.ts')
    .then((m) =>
      m.markIssuesReviewForBoardComplete({
        plannerChatId: planner.id,
        planPath: boardPlanPath,
      }),
    )
    .catch((err) => reportBackgroundError('issues-board-complete-review', err));

  void firePlanCompleteWrapUpTurn(planner, board).catch((err) =>
    reportBackgroundError('orchestrate-plan-complete-wrap-up', err),
  );
}
