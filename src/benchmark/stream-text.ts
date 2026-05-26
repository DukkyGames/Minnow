/**
 * Benchmark stream text accumulation (prose + reasoning channels).
 */

import { extractStreamDelta, extractMessageText } from '../api/chat';
import { extractReasoningDelta, extractReasoningMessage } from '../api/reasoning';
import type { ChatCompletionChunk } from '../types';

/** Per-chunk assistant signal for benchmark completion text (content + reasoning). */
export function accumulateBenchmarkStreamDelta(chunk: ChatCompletionChunk): string {
  return extractStreamDelta(chunk) + extractReasoningDelta(chunk);
}

/** Non-streaming fallback message → combined assistant text for benchmarks. */
export function completionTextFromMessage(
  message: { content?: string; reasoning?: string; reasoning_content?: string } | null | undefined,
): string {
  const prose = extractMessageText(message).trim();
  const reasoning = extractReasoningMessage(message).trim();
  if (prose && reasoning) return `${prose}\n\n${reasoning}`;
  return prose || reasoning;
}

/** Full completion object from tryNonStreamingFallback. */
export function completionTextFromFallback(fallback: ChatCompletionChunk): string {
  return completionTextFromMessage(fallback.choices?.[0]?.message);
}
