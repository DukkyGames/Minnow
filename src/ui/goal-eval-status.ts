/**
 * Transcript + sidebar affordances while the /goal evaluator runs between turns.
 */

import { isGoalEvaluating } from '../chat/goal/evaluating-state';
import { isChatStreaming, isStreamDomVisible } from '../chat/streaming-state';
import { setSidebarStreamPhase, syncChatItemDotsInDom } from './chat-item-dot';
import { getActiveChatMountElement } from './chat-mount';
import { scrollChatIfPinned } from './chat-scroll';
import { syncGoalActiveHint } from './goal-active-hint';

const GOAL_EVAL_STATUS_CLASS = 'goal-eval-status';
const statusRowByChatId = new Map<string, HTMLElement>();

function buildGoalEvalStatusRow(): HTMLElement {
  const el = document.createElement('div');
  el.className = `${GOAL_EVAL_STATUS_CLASS} stream-status stream-status--thinking`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-busy', 'true');

  const dots = document.createElement('span');
  dots.className = 'stream-status__dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'stream-status__dot';
    dots.appendChild(dot);
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'stream-status__label';
  labelEl.textContent = 'Evaluating goal completion…';

  el.appendChild(dots);
  el.appendChild(labelEl);
  return el;
}

function showGoalEvalStatusRow(chatId: string): void {
  if (!isStreamDomVisible(chatId)) return;

  let row = statusRowByChatId.get(chatId);
  if (row?.isConnected) return;

  row = buildGoalEvalStatusRow();
  statusRowByChatId.set(chatId, row);
  getActiveChatMountElement().appendChild(row);
  scrollChatIfPinned();
}

function hideGoalEvalStatusRow(chatId: string): void {
  const row = statusRowByChatId.get(chatId);
  if (row) {
    row.remove();
    statusRowByChatId.delete(chatId);
  }
}

/** Sync composer hint, transcript row, and sidebar phase for goal evaluation. */
export function syncGoalEvalUi(chatId: string): void {
  const evaluating = isGoalEvaluating(chatId);

  if (evaluating) {
    showGoalEvalStatusRow(chatId);
    setSidebarStreamPhase('thinking', chatId);
  } else {
    hideGoalEvalStatusRow(chatId);
    if (!isChatStreaming(chatId)) {
      setSidebarStreamPhase(null, chatId);
    }
  }

  syncGoalActiveHint();
  syncChatItemDotsInDom();
}
