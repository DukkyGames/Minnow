/**
 * Benchmark stream text accumulation (assistant prose + reasoning fallback).
 * Chat keeps reasoning in the thought UI; benchmarks prefer `content` but accept
 * reasoning when the model never emits main content (common on longer prompts).
 */

import { StreamingContentAccumulator } from '../api/message-content.ts';
import { extractStreamDelta, extractMessageText } from '../api/chat';
import { extractReasoningDelta, extractReasoningMessage } from '../api/reasoning.ts';
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

/** Concatenates reasoning-channel SSE deltas (used only when prose stays empty). */
export class BenchmarkStreamReasoningAccumulator {
  private text = '';

  ingestChunk(chunk: ChatCompletionChunk): void {
    this.text += extractReasoningDelta(chunk);
  }

  getText(): string {
    return this.text;
  }
}

/** Prefer main `content`; use reasoning when the model never surfaced prose. */
export function resolveBenchmarkCompletionText(
  contentText: string,
  reasoningText: string,
): string {
  const content = contentText.trim();
  if (content) return content;
  return reasoningText.trim();
}

/** Editor autocomplete / Quick Edit: main `content` only (never reasoning). */
export function resolveEditorCompletionText(contentText: string): string {
  return contentText.trim();
}

/** Per-chunk assistant prose for legacy/tests (`extractStreamDelta` single-chunk view). */
export function accumulateBenchmarkStreamDelta(chunk: ChatCompletionChunk): string {
  return extractStreamDelta(chunk);
}

/** Non-streaming message → main `content` only (no reasoning). */
export function completionTextFromMessage(
  message: { content?: string | unknown } | null | undefined,
): string {
  return extractMessageText(message).trim();
}

/** Full completion object from tryNonStreamingFallback (content, then reasoning). */
export function completionTextFromFallback(fallback: ChatCompletionChunk): string {
  const message = fallback.choices?.[0]?.message;
  return resolveBenchmarkCompletionText(
    completionTextFromMessage(message),
    extractReasoningMessage(message),
  );
}
