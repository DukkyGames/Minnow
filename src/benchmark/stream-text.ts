/**
 * Benchmark stream text accumulation (assistant prose + reasoning fallback).
 * Chat keeps reasoning in the thought UI; benchmarks prefer `content` but accept
 * reasoning when the model never emits main content (common on longer prompts).
 */

import { extractStreamDelta, extractMessageText } from '../api/chat';
import { extractReasoningDelta, extractReasoningMessage } from '../api/reasoning.ts';
import {
  HarmonyChannelRouter,
  InlineContentThinkingRouter,
  modelLikelyUsesInlineThinking,
  type RoutedContentPart,
} from '../api/inline-thinking.ts';
import { StreamingContentAccumulator } from '../api/message-content.ts';
import { ContentToolCallRouter } from '../providers/xml-tool-calls.ts';
import type { ThinkingBudgetTracker } from '../agents/thinking-budget.ts';
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

/**
 * Routes inline-thinking and harmony-channel content deltas during benchmark streaming.
 * Mirrors chat/sub-agent routing so prose and reasoning land in separate buckets.
 */
export class BenchmarkStreamContentRouter {
  private proseText = '';

  private reasoningText = '';

  private readonly inlineRouter: InlineContentThinkingRouter;

  private readonly harmonyRouter = new HarmonyChannelRouter();

  private readonly toolCallRouter = new ContentToolCallRouter();

  private readonly thinkingBudgetTracker: ThinkingBudgetTracker | null;

  private readonly cumulativeBudget: boolean;

  private budgetTripped = false;

  constructor(
    modelId: string,
    thinkingBudgetTracker?: ThinkingBudgetTracker | null,
    options: { cumulativeBudget?: boolean } = {},
  ) {
    this.inlineRouter = new InlineContentThinkingRouter({
      thinkingModel: modelLikelyUsesInlineThinking(modelId),
    });
    this.thinkingBudgetTracker = thinkingBudgetTracker ?? null;
    // The tracker already banks across phases (one budget per turn/probe). Skipping
    // endSession keeps the tripped flag set across prose instead of starting a new phase.
    this.cumulativeBudget = options.cumulativeBudget === true;
  }

  get thinkingBudgetExceeded(): boolean {
    return this.budgetTripped;
  }

  getProseText(): string {
    return this.proseText;
  }

  getReasoningText(): string {
    return this.reasoningText;
  }

  getCommentaryParseText(): string {
    return this.harmonyRouter.getCommentaryParseText();
  }

  getToolCallParseText(): string {
    return this.toolCallRouter.getToolCallParseText();
  }

  ingestReasoningDelta(delta: string): void {
    if (!delta) return;
    this.feedThinkingBudget(delta);
    this.reasoningText += delta;
  }

  ingestContentDelta(delta: string): void {
    if (!delta) return;
    for (const [harmonyText, isHarmonyThinking] of this.harmonyRouter.feed(delta)) {
      if (isHarmonyThinking) {
        if (harmonyText) {
          this.feedThinkingBudget(harmonyText);
          this.reasoningText += harmonyText;
        }
        continue;
      }
      this.processRoutedParts(this.inlineRouter.feed(harmonyText));
    }
  }

  flush(): void {
    for (const [harmonyText, isHarmonyThinking] of this.harmonyRouter.flush()) {
      if (isHarmonyThinking) {
        if (harmonyText) {
          this.feedThinkingBudget(harmonyText);
          this.reasoningText += harmonyText;
        }
        continue;
      }
      this.processRoutedParts(this.inlineRouter.feed(harmonyText));
    }
    this.processRoutedParts(this.inlineRouter.flush());
    this.proseText += this.toolCallRouter.flush();
  }

  private feedThinkingBudget(delta: string): void {
    if (!this.thinkingBudgetTracker || !delta || this.budgetTripped) return;
    this.thinkingBudgetTracker.feed(delta);
    if (this.thinkingBudgetTracker.exceeded) {
      this.budgetTripped = true;
    }
  }

  private processRoutedParts(parts: RoutedContentPart[]): void {
    for (const [text, isThinking] of parts) {
      if (isThinking) {
        if (text) {
          this.feedThinkingBudget(text);
          this.reasoningText += text;
        }
        continue;
      }
      if (!text) continue;
      if (!this.cumulativeBudget) this.thinkingBudgetTracker?.endSession();
      // `<tool_call>` markup is withheld from prose and parsed as tool calls instead.
      this.proseText += this.toolCallRouter.feed(text);
    }
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
