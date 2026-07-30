/**
 * Persisted transcript rows for auto-trim / manual compress events.
 */

import type { ContextEnforcementPolicy } from '../context-budget';
import type { Chat, ContextNoticeMessage, Message } from '../../types';

export function contextNoticeLabel(
  policy: ContextEnforcementPolicy,
  droppedTurns: number,
): string {
  const turnPart =
    droppedTurns > 0
      ? ` · ${droppedTurns} turn${droppedTurns === 1 ? '' : 's'} omitted`
      : '';
  switch (policy) {
    case 'summarize':
      return `Context summarized${turnPart}`;
    case 'dropMiddle':
      return `Context compressed (extractive)${turnPart}`;
    case 'slide':
      return `Context trimmed (slide)${turnPart}`;
    case 'truncate':
      return `Context trimmed (truncate)${turnPart}`;
    case 'archive':
      return `Context archived${turnPart}`;
    default:
      return `Context trimmed${turnPart}`;
  }
}

/**
 * Append a context notice unless the last row is a duplicate (same policy + dropped count).
 */
export function appendContextNoticeIfNeeded(
  chat: Chat,
  params: {
    policy: ContextEnforcementPolicy;
    droppedTurns: number;
    summaryText?: string;
  },
): void {
  if (params.droppedTurns <= 0 && !params.summaryText?.trim()) return;

  const last = chat.history[chat.history.length - 1];
  if (
    last &&
    last.role === 'context' &&
    last.policy === params.policy &&
    last.droppedTurns === params.droppedTurns
  ) {
    return;
  }

  const notice: ContextNoticeMessage = {
    role: 'context',
    policy: params.policy,
    droppedTurns: params.droppedTurns,
    summaryText: params.summaryText,
    createdAt: Date.now(),
  };
  chat.history.push(notice);
}

export function isContextNoticeMessage(msg: Message): msg is ContextNoticeMessage {
  return msg.role === 'context';
}
