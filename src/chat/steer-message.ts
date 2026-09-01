/**
 * Interrupt-and-steer: queue user corrections on an in-flight turn and inject them
 * at the next tool-loop boundary without aborting the current stream.
 *
 * P10-I / MIN-774: `runChatTurn` implements `runTurn({ onRoundBoundary })` with
 * {@link consumePendingSteer} so the SAME turn continues. Do not abort the
 * live generation when a steer is enqueued — that was the P6-C overlay this
 * phase replaces.
 */

import type { Chat } from '../types';
import {
  recordChatMessage,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { isStreamDomVisible } from './streaming-state';
import { appendBubble } from '../ui/messages';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import { markMessageSteered } from '../ui/steer-affordance';
import { forceCloseAskQuestionModal } from '../ui/question-cards-modal';

type SteerEnqueuedListener = (chatId: string) => void;
let steerEnqueuedListener: SteerEnqueuedListener | null = null;

/** @internal Optional UI hook when push-now steer is queued. P10-I does not abort. */
export function setSteerEnqueuedListener(listener: SteerEnqueuedListener | null): void {
  steerEnqueuedListener = listener;
}

function notifySteerEnqueued(chatId: string): void {
  steerEnqueuedListener?.(chatId);
}

/** History/API content for a consumed steer row (plain user text in v1). */
export function formatSteerHistoryContent(text: string): string {
  return text.trim();
}

/** Last-write-wins slot for the next tool-loop consume. */
export function enqueueSteerMessage(chat: Chat, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  forceCloseAskQuestionModal();
  chat.pendingSteerMessage = trimmed;
  touchChat(chat);
  scheduleSaveSessions();
  notifySteerEnqueued(chat.id);
  return true;
}

/** Drop queued steer (e.g. user stopped generation). */
export function clearPendingSteer(chat: Chat): void {
  if (!chat.pendingSteerMessage) return;
  chat.pendingSteerMessage = undefined;
  touchChat(chat);
  scheduleSaveSessions();
}

export interface ConsumePendingSteerOptions {
  /** When true, append a user bubble + steer chip if this chat's stream DOM is visible. */
  renderDom?: boolean;
}

export interface ConsumePendingSteerResult {
  consumed: boolean;
  content?: string;
  historyIndex?: number;
}

/**
 * Move pending steer into chat.history as a user message (tool-loop boundary).
 * Call from `runChatTurn`'s `onRoundBoundary` before the next model round.
 */
export function consumePendingSteer(
  chat: Chat,
  options: ConsumePendingSteerOptions = {},
): ConsumePendingSteerResult {
  const trimmed = chat.pendingSteerMessage?.trim();
  if (!trimmed) return { consumed: false };

  const content = formatSteerHistoryContent(trimmed);
  chat.history.push({ role: 'user', content, steer: true });
  recordChatMessage(chat);
  touchChat(chat);
  chat.pendingSteerMessage = undefined;
  scheduleSaveSessions();

  const historyIndex = chat.history.length - 1;
  const shouldRenderDom =
    options.renderDom !== false && isStreamDomVisible(chat.id);
  if (shouldRenderDom) {
    const { wrap } = appendBubble('user', content, {
      historyIndex,
      turnKind: 'user',
      chatId: chat.id,
    });
    markMessageSteered(wrap);
    void import('../ui/message-actions').then((m) => {
      m.attachMessageActions(wrap, {
        chatId: chat.id,
        historyIndex,
        turnKind: 'user',
      });
    });
    scrollChatIfPinned();
  }

  return { consumed: true, content, historyIndex };
}
