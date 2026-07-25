/**
 * Transcript + sidebar affordances while the /goal evaluator runs between turns.
 */

import { isGoalEvaluating } from '../chat/goal/evaluating-state';
import { getGoalEvalSession } from '../chat/goal/eval-session';
import { isChatStreaming, isStreamDomVisible } from '../chat/streaming-state';
import { setSidebarStreamPhase, syncChatItemDotsInDom } from './chat-item-dot';
import { getActiveChatMountElement } from './chat-mount';
import { scrollChatIfPinned } from './chat-scroll';
import { syncGoalActiveHint } from './goal-active-hint';
import { syncLoopActiveHint } from './loop-active-hint';
import { openGoalEvalDrawer, initGoalEvalDrawerLiveUpdates } from './goal-eval-drawer';

const GOAL_EVAL_STATUS_CLASS = 'goal-eval-status';
const statusRowByChatId = new Map<string, HTMLElement>();

function openGoalEvalFromStatus(chatId: string): void {
  if (!getGoalEvalSession(chatId)) return;
  openGoalEvalDrawer(chatId);
}

function buildGoalEvalStatusRow(chatId: string): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `${GOAL_EVAL_STATUS_CLASS} stream-status stream-status--thinking goal-eval-status--clickable`;
  el.dataset.chatId = chatId;
  el.setAttribute('aria-label', 'Evaluating goal completion. Click to view evaluator activity.');

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

  const hintEl = document.createElement('span');
  hintEl.className = 'goal-eval-status__hint';
  hintEl.textContent = 'View activity';

  el.appendChild(dots);
  el.appendChild(labelEl);
  el.appendChild(hintEl);

  const open = (): void => {
    openGoalEvalFromStatus(chatId);
  };
  el.addEventListener('click', open);
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      open();
    }
  });

  return el;
}

function showGoalEvalStatusRow(chatId: string): void {
  if (!isStreamDomVisible(chatId)) return;

  let row = statusRowByChatId.get(chatId);
  if (row?.isConnected) return;

  row = buildGoalEvalStatusRow(chatId);
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

/** One-time init for goal-eval drawer live updates. */
export function initGoalEvalUi(): void {
  initGoalEvalDrawerLiveUpdates();
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
  syncLoopActiveHint();
  syncChatItemDotsInDom();
}
