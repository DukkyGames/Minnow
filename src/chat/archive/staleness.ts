/**
 * Detect which chat history turns are stale enough to archive (pure, MIN-139).
 */

import { estimateTokensFromText } from '../prompts/token-estimate-core';
import type { Message } from '../../types';
import type { ArchiveConfig } from './types';

/** One user-started turn slice over chat.history. */
export interface HistoryTurnSlice {
  /** 0-based turn ordinal among user-started turns. */
  turnIndex: number;
  /** Inclusive start index in chat.history. */
  startIndex: number;
  /** Exclusive end index in chat.history. */
  endIndex: number;
}

/** Partition history into turns that start at each user message. */
export function partitionHistoryTurns(history: Message[]): HistoryTurnSlice[] {
  const turns: HistoryTurnSlice[] = [];
  let i = 0;
  let turnIndex = 0;
  while (i < history.length) {
    if (history[i].role !== 'user') {
      i += 1;
      continue;
    }
    const startIndex = i;
    i += 1;
    while (i < history.length && history[i].role !== 'user') {
      i += 1;
    }
    turns.push({ turnIndex, startIndex, endIndex: i });
    turnIndex += 1;
  }
  return turns;
}

function serializeHistoryMessage(msg: Message): string {
  if (msg.role === 'user' || msg.role === 'assistant') {
    return String(msg.content ?? '');
  }
  if (msg.role === 'tool') {
    return String(msg.content ?? '');
  }
  return '';
}

function estimateHistoryTokens(history: Message[]): number {
  let total = 0;
  for (const msg of history) {
    total += estimateTokensFromText(serializeHistoryMessage(msg));
  }
  return total;
}

/** Group consecutive stale turn slices into archive ranges. */
export function groupStaleTurnsIntoRanges(
  turns: HistoryTurnSlice[],
  staleTurnIndices: Set<number>,
): { startIndex: number; endIndex: number; sourceTurnIndices: number[] }[] {
  const ranges: { startIndex: number; endIndex: number; sourceTurnIndices: number[] }[] = [];
  let current: { startIndex: number; endIndex: number; sourceTurnIndices: number[] } | null =
    null;

  for (const turn of turns) {
    if (!staleTurnIndices.has(turn.turnIndex)) {
      if (current) {
        ranges.push(current);
        current = null;
      }
      continue;
    }
    const indices: number[] = [];
    for (let i = turn.startIndex; i < turn.endIndex; i += 1) {
      indices.push(i);
    }
    if (!current) {
      current = {
        startIndex: turn.startIndex,
        endIndex: turn.endIndex,
        sourceTurnIndices: indices,
      };
    } else if (current.endIndex === turn.startIndex) {
      current.endIndex = turn.endIndex;
      current.sourceTurnIndices.push(...indices);
    } else {
      ranges.push(current);
      current = {
        startIndex: turn.startIndex,
        endIndex: turn.endIndex,
        sourceTurnIndices: indices,
      };
    }
  }
  if (current) ranges.push(current);
  return ranges;
}

/**
 * Return history ranges that should be archived.
 * Stale when older than stalenessTurns from the latest user turn, or when
 * pressureThreshold is met (optional contextLimit + estimated fill).
 */
export function detectStaleTurnRanges(
  history: Message[],
  config: ArchiveConfig,
  options?: { estimatedTokens?: number; contextLimit?: number | null },
): { startIndex: number; endIndex: number; sourceTurnIndices: number[] }[] {
  const turns = partitionHistoryTurns(history);
  if (turns.length <= config.minRecentTurns) {
    return [];
  }

  const latestTurnIndex = turns[turns.length - 1]?.turnIndex ?? 0;
  const staleByAge = new Set<number>();
  for (const turn of turns) {
    const age = latestTurnIndex - turn.turnIndex;
    if (age >= config.stalenessTurns) {
      staleByAge.add(turn.turnIndex);
    }
  }

  const stale = new Set(staleByAge);
  const limit = options?.contextLimit ?? null;
  const estimated =
    options?.estimatedTokens ?? estimateHistoryTokens(history);
  if (
    limit != null &&
    limit > 0 &&
    estimated / limit >= config.pressureThreshold
  ) {
    const keepRecent = Math.max(1, config.minRecentTurns);
    const cutoff = Math.max(0, turns.length - keepRecent);
    for (let i = 0; i < cutoff; i += 1) {
      stale.add(turns[i].turnIndex);
    }
  }

  const protectedRecent = turns.slice(-config.minRecentTurns);
  for (const turn of protectedRecent) {
    stale.delete(turn.turnIndex);
  }

  if (stale.size === 0) return [];
  return groupStaleTurnsIntoRanges(turns, stale);
}
