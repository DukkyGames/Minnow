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

function winnerSides(
  winner: CompareWinner,
): { left: 'wins' | 'losses' | 'ties' | 'bothBad'; right: 'wins' | 'losses' | 'ties' | 'bothBad' } {
  switch (winner) {
    case 'left':
      return { left: 'wins', right: 'losses' };
    case 'right':
      return { left: 'losses', right: 'wins' };
    case 'tie':
      return { left: 'ties', right: 'ties' };
    case 'both_bad':
      return { left: 'bothBad', right: 'bothBad' };
  }
}

/** Aggregate win rates from revealed votes (newest-first input is fine). */
export function aggregateWinRates(votes: CompareVote[]): CompareWinRateRow[] {
  const map = new Map<string, CompareWinRateRow>();
  for (const vote of votes) {
    if (!vote.revealed) continue;
    const sides = winnerSides(vote.winner);
    bump(map, vote.left, sides.left);
    bump(map, vote.right, sides.right);
  }

  const rows = [...map.values()];
  for (const row of rows) {
    const decisive = row.wins + row.losses;
    row.winRate = decisive > 0 ? row.wins / decisive : 0;
  }

  return rows.sort((a, b) => b.winRate - a.winRate || b.total - a.total);
}
