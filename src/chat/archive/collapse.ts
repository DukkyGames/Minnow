import type { ApiMessage } from '../../types';
import type { ArchiveHistoryRange, ArchivePreResult } from './types';
import { historyIndexOfApiMessage } from '../api-message-origin';
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

export function replaceArchivedRangesWithPlaceholder(
  messages: ApiMessage[],
  ranges: ArchiveHistoryRange[],
  historyLength: number,
): { messages: ApiMessage[]; archived: number } {
  if (ranges.length === 0) {
    return { messages, archived: 0 };
  }

  const rangeForHistoryIndex = (index: number): ArchiveHistoryRange | undefined =>
    ranges.find((r) => index >= r.startIndex && index < r.endIndex);

  const systemEnd = countPinnedSystemMessages(messages);

  const hasTags = messages
    .slice(systemEnd)
    .some((message) => historyIndexOfApiMessage(message) !== undefined);
  if (!hasTags) {
    return collapseByPosition(messages, ranges, historyLength, systemEnd);
  }

  const out: ApiMessage[] = messages.slice(0, systemEnd);
  const emitted = new Set<ArchiveHistoryRange>();
  let archived = 0;
  let carrier: number | undefined;

  for (let apiIdx = systemEnd; apiIdx < messages.length; apiIdx += 1) {
    const message = messages[apiIdx];

    if (isArchivedPlaceholder(message)) {
      out.push(message);
      carrier = undefined;
      continue;
    }

    const tagged = historyIndexOfApiMessage(message);
    let historyIndex: number | undefined;
    if (tagged !== undefined) {
      historyIndex = tagged;
      carrier = tagged;
    } else if (isToolImageFollowUpMessage(message) || message.role === 'tool') {
      historyIndex = carrier;
    }

    if (historyIndex === undefined) {
      out.push(message);
      carrier = undefined;
      continue;
    }

    const range = rangeForHistoryIndex(historyIndex);
    if (!range) {
      out.push(message);
      continue;
    }
    if (!emitted.has(range)) {
      out.push({ role: 'system', content: formatPlaceholder(range) });
      emitted.add(range);
      archived += 1;
    }
  }

  return { messages: out, archived };
}

function collapseByPosition(
  messages: ApiMessage[],
  ranges: ArchiveHistoryRange[],
  historyLength: number,
  systemEnd: number,
): { messages: ApiMessage[]; archived: number } {
  const collapsedHist = new Set<number>();
  for (const range of ranges) {
    for (let i = range.startIndex; i < range.endIndex; i += 1) {
      collapsedHist.add(i);
    }
  }
  if (collapsedHist.size === 0) {
    return { messages, archived: 0 };
  }

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

    if (isToolImageFollowUpMessage(messages[apiIdx])) {
      if (!collapsedHist.has(histIdx - 1)) {
        out.push(messages[apiIdx]);
      }
      apiIdx += 1;
      continue;
    }

    if (collapsedHist.has(histIdx)) {
      const range = ranges.find((r) => histIdx >= r.startIndex && histIdx < r.endIndex);
      if (range) {
        out.push({ role: 'system', content: formatPlaceholder(range) });
        archived += 1;
        const skipTo = range.endIndex;
        while (histIdx < skipTo && apiIdx < messages.length) {
          histIdx += 1;
          apiIdx += 1;
          while (apiIdx < messages.length && isToolImageFollowUpMessage(messages[apiIdx])) {
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
