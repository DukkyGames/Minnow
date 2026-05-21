import {
  cancelAssistantBubbleRenderDebounce,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import { buildPendingSnapshot } from '../state/pending-turn-shape';
import { syncPendingTurn } from '../state/pending-turn';
import { touchChat } from '../state/sessions';
import type { Chat } from '../types';
import { markMessageStopped } from '../ui/stopped-affordance';
import { setStatus } from '../ui/status';
import type { ThoughtBubbleController } from '../ui/thought-bubbles';
import type { StreamingStatusHandle } from '../ui/stream-status';
import type { ToolCall } from '../types';

/** DOM + history context when the user stops an in-flight assistant reply. */
export interface StoppedTurnContext {
  chat: Chat;
  wrap: HTMLElement;
  bubble: HTMLDivElement;
  cursor: HTMLDivElement;
  streamStatus: StreamingStatusHandle;
  thoughtController: ThoughtBubbleController | null;
  partialText: string;
  parentTurnId?: string;
  startedAt: number;
  modelId: string;
  providerId?: string;
  toolRound?: number;
  toolCalls?: ToolCall[];
}

/**
 * Tear down streaming UI, checkpoint partial assistant text on pendingTurn (not history).
 * User-stopped turns set `stopped: true` so reload does not auto-resume; a new send overwrites.
 */
export function finalizeStoppedTurn(ctx: StoppedTurnContext): void {
  const {
    chat,
    wrap,
    bubble,
    cursor,
    streamStatus,
    thoughtController,
    partialText,
    parentTurnId,
    startedAt,
    modelId,
    providerId,
    toolRound,
    toolCalls,
  } = ctx;

  cancelAssistantBubbleRenderDebounce();
  if (cursor.parentElement) cursor.remove();
  thoughtController?.abort();

  void parentTurnId;

  const text = partialText.trim();
  const wrapConnected = wrap.isConnected;

  if (text && wrapConnected) {
    wrap.classList.remove('msg--awaiting-prose');
    bubble.classList.remove('msg-bubble--awaiting');
    setAssistantBubbleContent(bubble, text, { streaming: false, modeId: chat.modeId });
    markMessageStopped(wrap);
  } else if (wrapConnected && wrap.classList.contains('msg--awaiting-prose')) {
    wrap.remove();
  }

  const snap = buildPendingSnapshot({
    content: text,
    thinking: thoughtController?.getSegmentsNormalized(),
    toolCalls: toolCalls?.length ? toolCalls : undefined,
    startedAt,
    modelId,
    providerId,
    toolRound,
    phase: 'streaming',
    stopped: true,
  });
  syncPendingTurn(chat, snap, { immediate: true });
  touchChat(chat);

  streamStatus.dispose();
  setStatus('ok', 'Stopped');
}
