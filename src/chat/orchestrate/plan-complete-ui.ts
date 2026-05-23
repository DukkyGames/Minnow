/**
 * UI side effects when an Orchestrate plan reaches all-complete (chat + toast).
 */

import {
  buildOrchestrateCompletionMessage,
  isOrchestratePlanComplete,
} from './plan-complete.ts';
import { getSupervisorChatState, markChatStalledForUi } from '../../agents/supervisor/state.ts';
import { emitBoardChange } from '../../state/orchestrate-board-events.ts';
import { findChatById, getActiveChat, scheduleSaveSessions, touchChat } from '../../state/sessions.ts';
import type { Chat } from '../../types.ts';

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
 * Mark supervisor state and surface completion once per chat when the board is all green.
 */
export async function maybeEmitOrchestratePlanComplete(chatId: string): Promise<void> {
  const chat = findChatById(chatId);
  const board = chat?.orchestrateBoard;
  if (!chat || !board || !isOrchestratePlanComplete(board)) return;

  const sup = getSupervisorChatState(chatId);
  const now = Date.now();
  if (sup.planCompletedAt == null) {
    sup.planCompletedAt = now;
    markChatStalledForUi(chatId, false);
    emitBoardChange(chatId);
  }

  if (sup.completionMessageShown) return;
  sup.completionMessageShown = true;

  const text = buildOrchestrateCompletionMessage(chat, board, now);
  chat.history.push({ role: 'assistant', content: text });
  touchChat(chat);
  scheduleSaveSessions();

  if (getActiveChat().id === chat.id) {
    const { renderChatFromHistory } = await import('../../ui/messages.ts');
    renderChatFromHistory(chat);
    showPlanCompleteToast('Orchestrate plan complete');
  }
}
