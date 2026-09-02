import type { Transaction } from '@codemirror/state';
import { changeIntersectsRegion } from './intent-context';

export interface PendingIntentResolve {
  from: number;
  to: number;
  intentText: string;
}

/** Map a pending anchor through a transaction; null when the anchor was dropped or edited. */
export function mapPendingResolveThroughTransaction(
  pending: PendingIntentResolve,
  tr: Transaction,
): PendingIntentResolve | null {
  if (tr.docChanged) {
    let dropped = false;
    tr.changes.iterChangedRanges((changeFrom, changeTo) => {
      if (dropped) return;
      if (
        changeFrom <= pending.from &&
        changeTo <= pending.from &&
        changeFrom === changeTo
      ) {
        dropped = true;
        return;
      }
      if (changeIntersectsRegion(changeFrom, changeTo, pending.from, pending.to)) {
        dropped = true;
      }
    });
    if (dropped) return null;
  }

  const from = tr.changes.mapPos(pending.from, 1);
  const to = tr.changes.mapPos(pending.to, -1);
  if (from >= to) return null;
  if (tr.state.doc.sliceString(from, to) !== pending.intentText) return null;
  return { from, to, intentText: pending.intentText };
}

/** Fold a list of transactions over a pending anchor. */
export function mapPendingThroughTransactions(
  pending: PendingIntentResolve,
  transactions: readonly Transaction[],
): PendingIntentResolve | null {
  let current: PendingIntentResolve | null = pending;
  for (const tr of transactions) {
    if (!current) return null;
    current = mapPendingResolveThroughTransaction(current, tr);
  }
  return current;
}

export function pendingToAnchor(pending: PendingIntentResolve): {
  from: number;
  to: number;
  intentText: string;
} {
  return { from: pending.from, to: pending.to, intentText: pending.intentText };
}
