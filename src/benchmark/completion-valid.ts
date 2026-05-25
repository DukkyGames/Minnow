/**
 * Shared pass criteria for benchmark suites that require model completion text.
 */

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
