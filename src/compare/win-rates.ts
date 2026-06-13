/**
 * Win-rate aggregation for revealed compare votes.
 */

import type { CompareVote, CompareWinRateRow, CompareWinner } from './types';

/** Composite key for provider-scoped model identity. */
export function compareModelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function bump(
  map: Map<string, CompareWinRateRow>,
  ref: { providerId: string; modelId: string },
  field: 'wins' | 'losses' | 'ties' | 'bothBad',
): void {
  const key = compareModelKey(ref.providerId, ref.modelId);
  const row =
    map.get(key) ??
    ({
      key,
      providerId: ref.providerId,
      modelId: ref.modelId,
      wins: 0,
      losses: 0,
      ties: 0,
      bothBad: 0,
      total: 0,
      winRate: 0,
    } satisfies CompareWinRateRow);
  row[field] += 1;
  row.total += 1;
  map.set(key, row);
}

/** Normalize legacy 2-up votes into slot refs. */
export function voteSlotRefs(vote: CompareVote): { providerId: string; modelId: string }[] {
  const normalized = normalizeCompareVote(vote);
  return normalized.slots.map((slot) => ({
    providerId: slot.providerId,
    modelId: slot.modelId,
  }));
}

/**
 * Ensure `slots` is populated — older localStorage rows may only have left/right.
 */
export function normalizeCompareVote(vote: CompareVote): CompareVote {
  if (Array.isArray(vote.slots) && vote.slots.length > 0) {
    return vote;
  }
  if (vote.left && vote.right) {
    return {
      ...vote,
      slots: [
        {
          providerId: vote.left.providerId,
          modelId: vote.left.modelId,
          alias: vote.assignment?.leftAlias ?? 'A',
        },
        {
          providerId: vote.right.providerId,
          modelId: vote.right.modelId,
          alias: vote.assignment?.rightAlias ?? 'B',
        },
      ],
    };
  }
  return { ...vote, slots: [] };
}

/** Human-readable winner label for history rows. */
export function formatCompareWinnerLabel(vote: CompareVote): string {
  const normalized = normalizeCompareVote(vote);
  const winner = winnerSlotIndex(normalized);
  if (winner === 'tie') return 'Tie';
  if (winner === 'both_bad') {
    return normalized.slots.length > 2 ? 'All bad' : 'Both bad';
  }
  if (typeof winner === 'number') {
    const alias = normalized.slots[winner]?.alias;
    return alias ? `${alias} wins` : `Slot ${winner + 1} wins`;
  }
  if (normalized.winner === 'left') {
    return `Left (${normalized.assignment?.leftAlias ?? 'A'})`;
  }
  if (normalized.winner === 'right') {
    return `Right (${normalized.assignment?.rightAlias ?? 'B'})`;
  }
  return String(normalized.winner);
}

/** Map winner to a screen slot index when possible. */
export function winnerSlotIndex(vote: CompareVote): number | 'tie' | 'both_bad' | null {
  const winner: CompareWinner = vote.winner;
  if (winner === 'tie' || winner === 'both_bad') {
    return winner;
  }
  if (typeof winner === 'number' && Number.isInteger(winner)) {
    return winner;
  }
  if (winner === 'left') return 0;
  if (winner === 'right') return 1;
  return null;
}

/** Aggregate win rates from revealed votes (newest-first input is fine). */
export function aggregateWinRates(votes: CompareVote[]): CompareWinRateRow[] {
  const map = new Map<string, CompareWinRateRow>();

  for (const vote of votes) {
    if (!vote.revealed) continue;
    const normalized = normalizeCompareVote(vote);
    const refs = normalized.slots.map((slot) => ({
      providerId: slot.providerId,
      modelId: slot.modelId,
    }));
    if (refs.length === 0) continue;

    const winner = winnerSlotIndex(normalized);
    if (winner === null) continue;

    if (winner === 'tie') {
      for (const ref of refs) bump(map, ref, 'ties');
      continue;
    }
    if (winner === 'both_bad') {
      for (const ref of refs) bump(map, ref, 'bothBad');
      continue;
    }

    for (let i = 0; i < refs.length; i += 1) {
      bump(map, refs[i], i === winner ? 'wins' : 'losses');
    }
  }

  const rows = [...map.values()];
  for (const row of rows) {
    const decisive = row.wins + row.losses;
    row.winRate = decisive > 0 ? row.wins / decisive : 0;
  }

  return rows.sort((a, b) => b.winRate - a.winRate || b.total - a.total);
}
