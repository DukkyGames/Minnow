/**
 * Shared pass criteria for benchmark suites that require model completion text.
 */

import type { OneShotResult } from './llm-driver.ts';

/** True when streamed or one-shot completion has non-whitespace content. */
export function hasNonEmptyCompletion(text: string): boolean {
  return text.trim().length > 0;
}

/** User-facing details for speed-style tests. */
export function speedCompletionDetails(text: string): string {
  if (!hasNonEmptyCompletion(text)) {
    return 'empty completion (0 chars)';
  }
  return `${text.length} chars`;
}

/** cap-stream / multimodal details: preview on pass, actionable message on empty stream. */
export function streamCompletionTestDetails(stream: OneShotResult, passed: boolean): string {
  if (passed) return stream.text.trim().slice(0, 320);
  const finish = stream.finishReason ?? 'none';
  const ct = stream.timing.usage?.completion_tokens;
  const usage =
    ct != null || stream.timing.usage?.total_tokens != null
      ? `, completion_tokens=${ct ?? '?'}, total_tokens=${stream.timing.usage?.total_tokens ?? '?'}`
      : '';
  return `empty stream (finish=${finish}${usage})`;
}
