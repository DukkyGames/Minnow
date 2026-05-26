/**
 * Benchmark stream text accumulation (assistant prose only).
 * Reasoning/thinking streams to thought UI in chat; benchmarks score visible output.
 */

import { StreamingContentAccumulator } from '../api/message-content.ts';
import { extractStreamDelta, extractMessageText } from '../api/chat';
import type { ChatCompletionChunk } from '../types';

/** Merges prose `content` deltas across an SSE stream (indexed parts + string fragments). */
export class BenchmarkStreamTextAccumulator {
  private readonly content = new StreamingContentAccumulator();

  ingestChunk(chunk: ChatCompletionChunk): void {
    this.content.ingestChoice(chunk.choices?.[0]);
  }

  getText(): string {
    return this.content.getText();
  }
}

/** Per-chunk assistant prose for legacy/tests (`extractStreamDelta` single-chunk view). */
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
