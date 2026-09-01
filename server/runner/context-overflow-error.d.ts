/**
 * Recognize a provider's "prompt does not fit the window" rejection and, where
 * the provider says so, recover the two numbers it measured.
 */

export declare const CONTEXT_OVERFLOW_MARKERS: readonly string[];

/** True when `text` reads as a context-window overflow from any provider. */
export function isContextOverflowText(text: string): boolean;

/** Token counts a provider reported when rejecting an oversized request. */
export interface ContextOverflowNumbers {
  /** What the server measured for the request we just sent. */
  requestTokens: number;
  /** The window it has to fit in. */
  limitTokens: number;
}

/**
 * Recover the request/limit pair from a provider overflow message.
 * Returns null when the provider did not report a usable pair.
 */
export function parseContextOverflowNumbers(text: string): ContextOverflowNumbers | null;

/**
 * Message-estimate ceiling for a retry after `sentEstimate` tokens of messages
 * were rejected.
 */
export function contextRetryMessageLimit(
  sentEstimate: number,
  numbers: ContextOverflowNumbers | null,
  safetyMargin: number,
): number;
