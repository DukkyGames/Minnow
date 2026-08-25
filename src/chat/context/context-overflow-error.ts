/**
 * Recognize a provider's "prompt does not fit the window" rejection and, where
 * the provider says so, recover the two numbers it measured.
 *
 * This is the single most recoverable error a turn can hit: the request is too
 * big, the fix is to make it smaller, and the server just told us by how much.
 * Treating it as fatal is what turned context overflow into dead orchestrate
 * tasks.
 */

/**
 * Provider copy for a full context window. llama.cpp's wording ("exceeds the
 * available context size") matched none of the original markers, so the one
 * recovery path that existed never fired against Minnow's own server.
 */
export const CONTEXT_OVERFLOW_MARKERS: readonly string[] = [
  // llama.cpp / llama-server
  'exceeds the available context size',
  'exceeds the context size',
  'try increasing it',
  // OpenAI-compatible
  'context length exceeded',
  'context_length_exceeded',
  'maximum context length',
  'reduce the length of the messages',
  // Anthropic
  'prompt is too long',
  'exceed context limit',
  // generic / legacy
  'context limit has been reached',
  'exceed context window',
  'requested tokens',
];

/** True when `text` reads as a context-window overflow from any provider. */
export function isContextOverflowText(text: string): boolean {
  const lower = text.toLowerCase();
  return CONTEXT_OVERFLOW_MARKERS.some((marker) => lower.includes(marker));
}

/** Token counts a provider reported when rejecting an oversized request. */
export interface ContextOverflowNumbers {
  /** What the server measured for the request we just sent. */
  requestTokens: number;
  /** The window it has to fit in. */
  limitTokens: number;
}

/** `request (104264 tokens) exceeds the available context size (89088 tokens)` */
const LLAMA_CPP_NUMBERS =
  /request\s*\(\s*(\d+)\s*tokens?\s*\)[^()]*\(\s*(\d+)\s*tokens?\s*\)/i;

/**
 * Recover the request/limit pair from a provider overflow message.
 *
 * These two numbers are ground truth for how far off our own estimate was on
 * this exact request, which is what lets a retry target a real ceiling instead
 * of guessing again. Returns null when the provider did not report numbers, or
 * reported a pair that cannot be true (request at or under the limit).
 */
export function parseContextOverflowNumbers(
  text: string,
): ContextOverflowNumbers | null {
  const match = LLAMA_CPP_NUMBERS.exec(text);
  if (!match) return null;
  const requestTokens = Number(match[1]);
  const limitTokens = Number(match[2]);
  if (!Number.isFinite(requestTokens) || !Number.isFinite(limitTokens)) return null;
  if (requestTokens <= 0 || limitTokens <= 0) return null;
  if (requestTokens <= limitTokens) return null;
  return { requestTokens, limitTokens };
}

/**
 * Message-estimate ceiling for a retry after `sentEstimate` tokens of messages
 * were rejected.
 *
 * The provider's numbers cover the whole request — tool schemas, chat template,
 * everything — while `sentEstimate` covers only the messages, and the two are
 * on different scales because the estimate is an approximation. Scaling the
 * estimate by the provider's own overshoot ratio maps a real-token target back
 * into estimate space without needing either scale to be correct.
 */
export function contextRetryMessageLimit(
  sentEstimate: number,
  numbers: ContextOverflowNumbers | null,
  safetyMargin: number,
): number {
  if (sentEstimate <= 0) return 1;
  const shrink = numbers
    ? (numbers.limitTokens * safetyMargin) / numbers.requestTokens
    : safetyMargin * safetyMargin;
  return Math.max(1, Math.floor(sentEstimate * shrink));
}
