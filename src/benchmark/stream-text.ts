/**
 * Benchmark stream text accumulation (assistant prose only).
 * Reasoning/thinking streams to thought UI in chat; benchmarks score visible output.
 */

import { extractStreamDelta, extractMessageText } from '../api/chat';
import type { ChatCompletionChunk } from '../types';

/** Per-chunk assistant prose for benchmark completion text (`delta.content` only). */
export function accumulateBenchmarkStreamDelta(chunk: ChatCompletionChunk): string {
  return extractStreamDelta(chunk);
}

/** Non-streaming fallback message → assistant prose for benchmarks. */
export function completionTextFromMessage(
  message: { content?: string | unknown } | null | undefined,
): string {
  return extractMessageText(message).trim();
}

/** Full completion object from tryNonStreamingFallback. */
export function completionTextFromFallback(fallback: ChatCompletionChunk): string {
  return completionTextFromMessage(fallback.choices?.[0]?.message);
}
