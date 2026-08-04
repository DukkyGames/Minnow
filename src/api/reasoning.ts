/**
 * LM Studio reasoning streams: separate from assistant prose (`content`).
 * Supports `delta.reasoning` / `delta.reasoning_content` / `delta.thinking`
 * and non-streaming message fields.
 */

import type { ApiAssistantMessage } from '../types';
import type { ChatCompletionChunk } from '../types';

/** Pull reasoning text from one SSE JSON chunk (streaming). */
export function extractReasoningDelta(chunk: ChatCompletionChunk): string {
  const choice = chunk.choices?.[0];
  if (!choice) return '';
  const delta = choice.delta;
  if (!delta) return '';
  if (delta.reasoning) return delta.reasoning;
  if (delta.reasoning_content) return delta.reasoning_content;
  if (delta.thinking) return delta.thinking;
  const msg = choice.message;
  if (msg?.reasoning) return msg.reasoning;
  if (msg?.reasoning_content) return msg.reasoning_content;
  const msgThinking = (msg as { thinking?: string } | undefined)?.thinking;
  if (msgThinking) return msgThinking;
  return '';
}

/** Anthropic extended-thinking signature from a streamed reasoning delta (if present). */
export function extractReasoningSignatureDelta(chunk: ChatCompletionChunk): string {
  const signature = chunk.choices?.[0]?.delta?.reasoning_signature;
  return typeof signature === 'string' ? signature.trim() : '';
}

/** Reasoning string from a non-streaming completion message object. */
export function extractReasoningMessage(
  message:
    | { reasoning?: string; reasoning_content?: string; thinking?: string }
    | null
    | undefined,
): string {
  if (!message) return '';
  if (message.reasoning) return message.reasoning;
  if (message.reasoning_content) return message.reasoning_content;
  if (message.thinking) return message.thinking;
  return '';
}

/**
 * Split accumulated reasoning into discrete "thoughts" on paragraph breaks.
 * Trims segments and drops empty entries.
 */
export function splitThinkingSegments(buffer: string): string[] {
  const parts = buffer.split(/\n\n+/);
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * DeepSeek thinking mode (incl. OpenCode Go) requires `reasoning_content` on assistant
 * tool-loop turns — omitting it yields HTTP 400 on the next request.
 */
export function modelRequiresReasoningContentReplay(modelId: string): boolean {
  return /deepseek/i.test(modelId.trim());
}

/** Kimi / Moonshot APIs reject `reasoning` (and related) fields on chat message objects. */
export function modelRejectsMessageReasoningReplay(modelId: string): boolean {
  return /kimi|moonshot/i.test(modelId.trim());
}

export interface OutboundReasoningReplayOptions {
  /** DeepSeek tool-loop rows must always include `reasoning_content` (may be empty). */
  toolCallTurn?: boolean;
}

/** Outbound assistant fields for replaying reasoning on follow-up completions. */
export function outboundReasoningReplayFields(
  modelId: string,
  reasoningText: string,
  thinkingSignature?: string,
  options?: OutboundReasoningReplayOptions,
): Pick<ApiAssistantMessage, 'reasoning' | 'reasoning_content' | 'reasoning_signature'> {
  const trimmed = reasoningText.trim();
  const out: Pick<
    ApiAssistantMessage,
    'reasoning' | 'reasoning_content' | 'reasoning_signature'
  > = {};
  if (modelRejectsMessageReasoningReplay(modelId)) {
    return out;
  }

  const deepSeekToolLoop =
    options?.toolCallTurn === true && modelRequiresReasoningContentReplay(modelId);

  if (deepSeekToolLoop) {
    out.reasoning_content = trimmed;
  } else if (trimmed) {
    if (modelRequiresReasoningContentReplay(modelId)) {
      out.reasoning_content = trimmed;
    } else {
      out.reasoning = trimmed;
    }
  }
  if (thinkingSignature?.trim()) {
    out.reasoning_signature = thinkingSignature.trim();
  }
  return out;
}
