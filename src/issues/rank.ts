/**
 * Lexicographic fractional ranks for {@link IssueCard.rank}.
 *
 * Why strings, not numbers: inserting between two rows must not rewrite the
 * whole group. A key that sorts between its neighbours is enough; drag and
 * Alt+↑/↓ persist it via `updateIssue`. Header sort is a session fallback used
 * only when ranks are equal or missing — see `sortIssuesInGroup`.
 */

/** Base-36 digits so there is always room before `a` and after `z`. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const DIGIT_COUNT = DIGITS.length;
const MID = DIGITS[Math.floor(DIGIT_COUNT / 2)];

function digitIndex(ch: string): number {
  const idx = DIGITS.indexOf(ch);
  return idx < 0 ? 0 : idx;
}

/**
 * Return a rank strictly between `prev` and `next` (open bounds when null).
 *
 * Missing digits on `prev` read as before the alphabet; missing digits on
 * `next` read as after it. That is what makes a key between `a` and `b` (`ah`)
 * and a key before `a` (`5`) both work without colliding with a prefix.
 */
export function rankBetween(
  prev: string | null | undefined,
  next: string | null | undefined,
): string {
  const before = typeof prev === 'string' ? prev : '';
  const after = typeof next === 'string' ? next : '';
  if (before && after && before >= after) {
    // Callers can pass a stale pair after a concurrent move; land after prev
    // rather than throwing in a drag handler.
    return rankBetween(before, null);
  }

  const out: string[] = [];
  let i = 0;
  for (;;) {
    const prevIdx = i < before.length ? digitIndex(before[i]) : -1;
    const nextIdx = i < after.length ? digitIndex(after[i]) : DIGIT_COUNT;
    if (nextIdx - prevIdx > 1) {
      out.push(DIGITS[Math.floor((prevIdx + nextIdx) / 2)]);
      return out.join('');
    }
    // No gap at this position — copy the tighter bound and go one digit deeper.
    out.push(DIGITS[Math.max(prevIdx, 0)]);
    i += 1;
    if (i > 64) {
      return `${out.join('')}${MID}`;
    }
  }
}

/** First rank in an empty group. */
export function rankInitial(): string {
  return MID;
}

/**
 * Compare two optional ranks. Ranked rows sort before unranked ones so a
 * manual order the user started is not shuffled behind unsorted leftovers.
 *
 * That ranked-before-unranked rule is why the first Alt+↑/↓ or drag in a
 * group must {@link materializePeerRanks}: `rankBetween(null, null)` is `"h"`,
 * which still sorts *before* an unranked neighbour, so the DOM never swaps.
 */
export function compareIssueRank(a: string | undefined, b: string | undefined): number {
  if (a && b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

function hasRank(rank: string | undefined): rank is string {
  return typeof rank === 'string' && rank.length > 0;
}

/**
 * Lock the current visual order into rank keys when any peer is still
 * unranked. Why all peers, not only the moved row: `compareIssueRank` puts
 * any ranked id ahead of any unranked id, so writing `"h"` onto the first of
 * two unranked rows leaves it first. After this, every peer has a key and a
 * later insert can land *between* or *after* neighbours.
 *
 * Peers that already all have ranks are left alone so fractional inserts
 * keep working.
 */
export function materializePeerRanks(
  orderedIds: readonly string[],
  existing: ReadonlyMap<string, string | undefined>,
): Map<string, string> {
  const allRanked = orderedIds.every((id) => hasRank(existing.get(id)));
  if (allRanked) {
    return new Map(orderedIds.map((id) => [id, existing.get(id)!]));
  }
  const ranks = new Map<string, string>();
  let prev: string | null = null;
  for (const id of orderedIds) {
    const rank = rankBetween(prev, null);
    ranks.set(id, rank);
    prev = rank;
  }
  return ranks;
}

/**
 * Rank to insert `movingId` so it lands at `toIndex` in `orderedIds`
 * (the group's current visual order, *before* the move is applied).
 */
export function rankForMove(
  orderedIds: readonly string[],
  ranks: ReadonlyMap<string, string | undefined>,
  movingId: string,
  toIndex: number,
): string {
  const without = orderedIds.filter((id) => id !== movingId);
  const clamped = Math.max(0, Math.min(toIndex, without.length));
  const prevId = clamped > 0 ? without[clamped - 1] : undefined;
  const nextId = clamped < without.length ? without[clamped] : undefined;
  return rankBetween(
    prevId ? ranks.get(prevId) : null,
    nextId ? ranks.get(nextId) : null,
  );
}

/**
 * Ranks to persist after moving `movingIds` to `insertIndex` in `orderedIds`
 * (visual order before the move). Materializes unranked peers first so
 * Alt+↓ / drag use the same insert math as a fully ranked group.
 */
export function ranksAfterReorder(
  orderedIds: readonly string[],
  existing: ReadonlyMap<string, string | undefined>,
  movingIds: readonly string[],
  insertIndex: number,
): Map<string, string> {
  const ranks = materializePeerRanks(orderedIds, existing);
  const without = orderedIds.filter((id) => !movingIds.includes(id));
  const clamped = Math.max(0, Math.min(insertIndex, without.length));
  let prev: string | null = clamped > 0 ? (ranks.get(without[clamped - 1]) ?? null) : null;
  const next: string | null =
    clamped < without.length ? (ranks.get(without[clamped]) ?? null) : null;
  const out = new Map(ranks);
  for (const id of movingIds) {
    const rank = rankBetween(prev, next);
    out.set(id, rank);
    prev = rank;
  }
  return out;
}
