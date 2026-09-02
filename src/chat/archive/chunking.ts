import type { ApiMessage } from '../../types';
import { estimateApiMessagesTokens } from '../context-budget';
import type { ArchiveHistoryRange } from './types';

/** Token budget per bundle request (aligned with server synthesis maxTokens + prompt). */
export const BUNDLER_TOKEN_BUDGET = 14_000;

/**
 * Split one stale range into consecutive sub-ranges when turn slice exceeds maxTokens.
 */
export function splitRangeForBundling(
  range: ArchiveHistoryRange,
  turns: ApiMessage[],
  maxTokens: number = BUNDLER_TOKEN_BUDGET,
): ArchiveHistoryRange[] {
  if (turns.length === 0) return [];
  if (estimateApiMessagesTokens(turns) <= maxTokens) return [range];

  const chunks: ArchiveHistoryRange[] = [];
  let start = 0;
  while (start < turns.length) {
    let end = start + 1;
    while (end < turns.length) {
      const slice = turns.slice(start, end + 1);
      if (estimateApiMessagesTokens(slice) > maxTokens) break;
      end += 1;
    }
    const indices = range.sourceTurnIndices.slice(start, end);
    if (indices.length === 0) break;
    chunks.push({
      startIndex: indices[0] ?? range.startIndex,
      endIndex: (indices[indices.length - 1] ?? range.startIndex) + 1,
      sourceTurnIndices: indices,
    });
    start = end;
  }
  return chunks.length ? chunks : [range];
}
