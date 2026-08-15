/**
 * Client-side thinking budget tracker and continuation builders for watchdog nudges.
 *
 * The budget bounds one user turn: the tracker banks each completed thinking phase and
 * checks the limit against the turn total, so a multi-tool turn cannot spend the budget
 * once per loop iteration.
 */

import type { ApiMessage } from '../types';
import { estimateTokensFromText } from '../chat/prompts/token-estimate-core';

/** First-person nudge appended inside prefilled thinking so the model commits to an answer. */
export const THINKING_BUDGET_NUDGE_LINE =
  "I've spent enough time thinking. I'll commit to an answer now.";

/** Base instruction sent when the budget trips (used inside the continuation payload). */
export const THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION =
  'Stop extended reasoning. Answer directly in your next reply without further internal deliberation.';

/**
 * Extra allowance granted to a continuation so it can write a short wrap-up thought
 * instead of re-tripping on its first reasoning delta.
 */
export function thinkingBudgetGraceTokens(baseLimitTokens: number): number {
  const base = Math.max(1, Math.round(baseLimitTokens));
  return Math.max(256, Math.round(base * 0.25));
}

/**
 * Tracks approximate reasoning tokens across one user turn.
 * Call `endSession()` when prose or tool calls start so the phase is banked and the
 * next thinking block starts a fresh `sessionText` — the turn total keeps accumulating.
 */
export class ThinkingBudgetTracker {
  private phaseText = '';
  private bankedTokens = 0;
  private _exceeded = false;
  private _nudgeCount = 0;
  private _disarmed = false;
  private readonly baseLimit: number;
  private limit: number;

  constructor(limitTokens: number) {
    this.baseLimit = Math.max(1, Math.round(limitTokens));
    this.limit = this.baseLimit;
  }

  get exceeded(): boolean {
    return this._disarmed ? false : this._exceeded;
  }

  /** Configured ceiling, so callers can mirror it into the outbound request body. */
  get limitTokens(): number {
    return this.limit;
  }

  /** Text of the current contiguous thinking phase — what a continuation carries forward. */
  get sessionText(): string {
    return this.phaseText;
  }

  get nudgeCount(): number {
    return this._nudgeCount;
  }

  /** Estimated reasoning tokens spent so far this turn (banked phases + current phase). */
  get spentTokens(): number {
    return this.bankedTokens + estimateTokensFromText(this.phaseText);
  }

  /** Feed a reasoning delta; marks exceeded when the turn total crosses the limit. */
  feed(delta: string): void {
    if (!delta || this._exceeded) return;
    // Some providers resend cumulative reasoning text each SSE chunk — replace, don't append.
    if (this.phaseText && delta.startsWith(this.phaseText)) {
      this.phaseText = delta;
    } else {
      this.phaseText += delta;
    }
    // Disarmed trackers keep counting for status text but never trip again this turn.
    if (!this._disarmed && this.spentTokens >= this.limit) {
      this._exceeded = true;
      this._nudgeCount += 1;
    }
  }

  /** Bank the current phase and start the next one — the turn total is kept. */
  endSession(): void {
    this.bankPhase();
    this._exceeded = false;
  }

  /**
   * Enter a budget continuation: bank the phase, clear the trip, and raise the ceiling by
   * a small grace so the continuation can wrap up its reasoning before tripping again.
   */
  beginContinuation(graceTokens?: number): void {
    this.bankPhase();
    this._exceeded = false;
    const grace = graceTokens ?? thinkingBudgetGraceTokens(this.baseLimit);
    this.limit += Math.max(0, Math.round(grace));
  }

  /** Permanently stop tripping for the rest of this turn (escalation already ran). */
  disarm(): void {
    this._disarmed = true;
    this._exceeded = false;
  }

  private bankPhase(): void {
    this.bankedTokens += estimateTokensFromText(this.phaseText);
    this.phaseText = '';
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

/**
 * Build the outbound-only continuation payload for a tripped budget.
 *
 * An assistant message carries the work done so far, followed by a user message telling the
 * model to continue from it. Unlike a trailing assistant prefill — which a plain
 * OpenAI-compatible endpoint reads as a *completed* turn — this shape works on every provider.
 */
export function buildBudgetContinuationMessages(opts: {
  partialThinking: string;
  partialText: string;
}): ApiMessage[] {
  const thinking = opts.partialThinking.trim();
  const text = opts.partialText.trim();
  const sections: string[] = [];
  if (thinking) {
    sections.push(`Reasoning so far:\n${thinking}`);
  }
  if (text) {
    sections.push(`Answer written so far:\n${text}`);
  }

  const messages: ApiMessage[] = [];
  if (sections.length > 0) {
    messages.push({ role: 'assistant', content: sections.join('\n\n') });
  }

  const carried = sections.length > 0;
  const instruction = carried
    ? `${THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION} Continue from the work above — keep its conclusions and pick up exactly where it stopped. Do not repeat it and do not start over.${
        text ? ' Write only the remaining part of the answer.' : ''
      }`
    : THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION;
  messages.push({ role: 'user', content: instruction });

  return messages;
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

/** Shortest echo of carried prose worth suppressing — below this, repeats are coincidence. */
const CARRIED_ECHO_MIN_CHARS = 40;

/**
 * Strip a verbatim repeat of already-rendered prose from the first delta of a continuation.
 * Carried text is seeded into the stream, so an echo would render twice.
 */
export function stripCarriedTextEcho(delta: string, carriedText: string): string {
  if (!delta || !carriedText) return delta;
  const carried = carriedText.trim();
  if (!carried) return delta;
  const lead = delta.replace(/^\s+/, '');
  if (!lead) return delta;
  // Whatever follows the echo is exactly what belongs after the carried prose — keep its
  // spacing verbatim so the join does not lose a space or a paragraph break.
  if (lead.startsWith(carried)) {
    return lead.slice(carried.length);
  }
  // The echo may arrive split across deltas — drop a leading chunk that only repeats.
  if (lead.length >= CARRIED_ECHO_MIN_CHARS && carried.startsWith(lead)) {
    return '';
  }
  return delta;
}
