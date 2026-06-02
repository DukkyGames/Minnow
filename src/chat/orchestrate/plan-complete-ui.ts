/**
 * UI side effects when an Orchestrate plan reaches all-complete (chat + toast).
 */

import {
  buildOrchestrateCompletionMessage,
  isOrchestratePlanComplete,
} from './plan-complete.ts';
import { emitBoardChange } from '../../state/orchestrate-board-events.ts';
import {
  findGroupById,
  getPlannerChatForGroup,
} from '../../state/chat-groups.ts';
import {
  findChatById,
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../../state/sessions.ts';

function showPlanCompleteToast(message: string): void {
  const el = document.createElement('div');
  el.className = 'orchestrate-watchdog-toast orchestrate-watchdog-toast--complete';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('orchestrate-watchdog-toast--visible'));
  window.setTimeout(() => {
    el.classList.remove('orchestrate-watchdog-toast--visible');
    window.setTimeout(() => el.remove(), 300);
  }, 6000);
}

/**
 * Surface completion once per board when every task is complete.
 */
export async function maybeEmitOrchestratePlanComplete(groupId: string): Promise<void> {
  const group = findGroupById(groupId);
  const board = group?.orchestrateBoard;
  const planner = group ? getPlannerChatForGroup(group) : undefined;
  if (!group || !board || !planner || !isOrchestratePlanComplete(board)) return;

  if (board.completionShownAt != null) return;
  board.completionShownAt = Date.now();
  emitBoardChange(groupId);

  const text = buildOrchestrateCompletionMessage(planner, board, board.completionShownAt);
  planner.history.push({ role: 'assistant', content: text });
  touchChat(planner);
  scheduleSaveSessions();

  const active = getActiveChat();
  if (active.id === planner.id || active.boardGroupId === groupId) {
    const { renderChatFromHistory } = await import('../../ui/messages.ts');
    renderChatFromHistory(active);
  }
  showPlanCompleteToast('Orchestrate plan complete');
}
