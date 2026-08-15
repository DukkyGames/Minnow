/**
 * Collapse archived history ranges to zero-cost placeholders in API messages (pure).
 */

import type { ApiMessage } from '../../types';
import type { ArchiveHistoryRange, ArchivePreResult } from './types';
import { isToolImageFollowUpMessage } from '../tool-image-follow-up';

const PLACEHOLDER_RE =
  /^<archived_context turns="(\d+)-(\d+)" \/>$/;

function formatPlaceholder(range: ArchiveHistoryRange): string {
  const first = range.sourceTurnIndices[0] ?? range.startIndex;
  const last =
    range.sourceTurnIndices[range.sourceTurnIndices.length - 1] ??
    range.endIndex - 1;
  return `<archived_context turns="${first}-${last}" />`;
}

function countPinnedSystemMessages(messages: ApiMessage[]): number {
  let n = 0;
  for (const msg of messages) {
    if (msg.role === 'system') n += 1;
    else break;
  }
  return n;
}

function isArchivedPlaceholder(msg: ApiMessage): boolean {
  return (
    msg.role === 'system' &&
    typeof msg.content === 'string' &&
    PLACEHOLDER_RE.test(msg.content)
  );
}

/**
 * Replace API messages for archived history ranges with synthetic system placeholders.
 * History index i maps to API index systemEnd + i except ephemeral screenshot
 * follow-ups (`toolImageFollowUp`), which do not consume a history index.
 */
export function replaceArchivedRangesWithPlaceholder(
  messages: ApiMessage[],
  ranges: ArchiveHistoryRange[],
  historyLength: number,
): { messages: ApiMessage[]; archived: number } {
  if (ranges.length === 0) {
    return { messages, archived: 0 };
  }

  const collapsedHist = new Set<number>();
  for (const range of ranges) {
    for (let i = range.startIndex; i < range.endIndex; i += 1) {
      collapsedHist.add(i);
    }
  }
  if (collapsedHist.size === 0) {
    return { messages, archived: 0 };
  }

  const systemEnd = countPinnedSystemMessages(messages);
  const out: ApiMessage[] = messages.slice(0, systemEnd);
  let histIdx = 0;
  let archived = 0;
  let apiIdx = systemEnd;

  while (apiIdx < messages.length && histIdx < historyLength) {
    if (isArchivedPlaceholder(messages[apiIdx])) {
      out.push(messages[apiIdx]);
      histIdx += 1;
      apiIdx += 1;
      continue;
    }

    // Screenshot follow-ups are not history rows — drop them with a collapsed tool, else keep.
    if (isToolImageFollowUpMessage(messages[apiIdx])) {
      if (!collapsedHist.has(histIdx - 1)) {
        out.push(messages[apiIdx]);
      }
      apiIdx += 1;
      continue;
    }

    if (collapsedHist.has(histIdx)) {
      const range = ranges.find(
        (r) => histIdx >= r.startIndex && histIdx < r.endIndex,
      );
      if (range) {
        out.push({ role: 'system', content: formatPlaceholder(range) });
        archived += 1;
        const skipTo = range.endIndex;
        while (histIdx < skipTo && apiIdx < messages.length) {
          histIdx += 1;
          apiIdx += 1;
          while (
            apiIdx < messages.length &&
            isToolImageFollowUpMessage(messages[apiIdx])
          ) {
            apiIdx += 1;
          }
        }
        continue;
      }
    }

    out.push(messages[apiIdx]);
    histIdx += 1;
    apiIdx += 1;
  }

  while (apiIdx < messages.length) {
    out.push(messages[apiIdx]);
    apiIdx += 1;
  }

  return { messages: out, archived };
}

/** Re-apply collapse from a prior send memo without Brain I/O. */
export function applyMemoizedCollapse(
  messages: ApiMessage[],
  memo: ArchivePreResult,
  historyLength: number,
): ApiMessage[] {
  let next = messages;

  if (memo.retrievedBlock?.trim()) {
    const systemEnd = countPinnedSystemMessages(next);
    const hasPrelude = next
      .slice(systemEnd, systemEnd + 1)
      .some(
        (m) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('<retrieved_context source="archive">'),
      );
    if (!hasPrelude) {
      next = [
        ...next.slice(0, systemEnd),
        { role: 'system', content: memo.retrievedBlock },
        ...next.slice(systemEnd),
      ];
    }
  }

  const collapsed = replaceArchivedRangesWithPlaceholder(
    next,
    memo.collapsedRanges,
    historyLength,
  );
  return collapsed.messages;
}
