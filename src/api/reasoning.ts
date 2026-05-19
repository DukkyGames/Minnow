/**
 * LM Studio reasoning streams: separate from assistant prose (`content`).
 * Supports `delta.reasoning` / `delta.reasoning_content` and non-streaming message fields.
 */

import type { ChatCompletionChunk } from '../types';

/** Pull reasoning text from one SSE JSON chunk (streaming). */
export function extractReasoningDelta(chunk: ChatCompletionChunk): string {
  const choice = chunk.choices?.[0];
  if (!choice) return '';
  const delta = choice.delta;
  if (!delta) return '';
  if (delta.reasoning) return delta.reasoning;
  if (delta.reasoning_content) return delta.reasoning_content;
  const msg = choice.message;
  if (msg?.reasoning) return msg.reasoning;
  if (msg?.reasoning_content) return msg.reasoning_content;
  return '';
}

/** Reasoning string from a non-streaming completion message object. */
export function extractReasoningMessage(
  message: { reasoning?: string; reasoning_content?: string } | null | undefined,
): string {
  if (!message) return '';
  if (message.reasoning) return message.reasoning;
  if (message.reasoning_content) return message.reasoning_content;
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
