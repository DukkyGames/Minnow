/**
 * Client-side thinking session budget tracker and prefill builders for watchdog nudges.
 */

import type { ApiMessage } from '../types';
import { estimateTokensFromText } from '../chat/prompts/token-estimate-core';

/** First-person nudge appended inside prefilled thinking so the model commits to an answer. */
export const THINKING_BUDGET_NUDGE_LINE =
  "I've spent enough time thinking. I'll commit to an answer now.";

/** Ephemeral user instruction when prefill-continue is rejected or unsupported. */
export const THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION =
  'Stop extended reasoning. Answer directly in your next reply without further internal deliberation.';

/**
 * Tracks approximate reasoning tokens for one contiguous thinking phase.
 * Call `endSession()` when prose starts so a later thinking block gets a fresh count.
 */
export class ThinkingBudgetTracker {
  private accumulatedText = '';
  private _exceeded = false;
  private _nudgeCount = 0;
  private readonly limit: number;

  constructor(limitTokens: number) {
    this.limit = Math.max(1, Math.round(limitTokens));
  }

  get exceeded(): boolean {
    return this._exceeded;
  }

  get sessionText(): string {
    return this.accumulatedText;
  }

  get nudgeCount(): number {
    return this._nudgeCount;
  }

  /** Feed a reasoning delta; marks exceeded when estimated tokens cross the limit. */
  feed(delta: string): void {
    if (!delta || this._exceeded) return;
    // Some providers resend cumulative reasoning text each SSE chunk — replace, don't append.
    if (this.accumulatedText && delta.startsWith(this.accumulatedText)) {
      this.accumulatedText = delta;
    } else {
      this.accumulatedText += delta;
    }
    if (estimateTokensFromText(this.accumulatedText) >= this.limit) {
      this._exceeded = true;
      this._nudgeCount += 1;
    }
  }

  /** Reset for the next contiguous thinking session within the same turn. */
  endSession(): void {
    this.accumulatedText = '';
    this._exceeded = false;
  }
}

/** Build outbound-only assistant prefill for inline-thinking continuation. */
export function buildThinkingPrefillAssistantMessage(
  partialThinking: string,
): ApiMessage {
  const partial = partialThinking.trimEnd();
  const inner = partial
    ? `${partial}\n\n${THINKING_BUDGET_NUDGE_LINE}`
    : THINKING_BUDGET_NUDGE_LINE;
  return {
    role: 'assistant',
    content: `<think>\n${inner}\n</think>\n\n`,
  };
}

/** Strip provider echo of a prefilled thinking block from the first continuation delta. */
export function stripPrefillEchoFromDelta(delta: string, partialThinking: string): string {
  if (!delta) return delta;
  let text = delta;
  const trimmedPartial = partialThinking.trim();
  if (trimmedPartial && text.includes(trimmedPartial.slice(0, Math.min(80, trimmedPartial.length)))) {
    const closeIdx = text.indexOf('</think>');
    if (closeIdx >= 0) {
      text = text.slice(closeIdx + '</think>'.length);
      text = text.replace(/^\s*\n+/, '');
    }
  }
  if (text.startsWith('<think>')) {
    const closeIdx = text.indexOf('</think>');
    if (closeIdx >= 0) {
      text = text.slice(closeIdx + '</think>'.length);
      text = text.replace(/^\s*\n+/, '');
    }
  }
  return text;
}
