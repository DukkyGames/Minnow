/**
 * In-flight issue-row drag. `dragover` cannot read `getData`, so drop
 * targets read this module instead of the MIME payload.
 */

export const ISSUE_DRAG_MIME = 'application/x-minnow-issue-id';

let activeIds: string[] = [];

/** Remember which issue ids are being dragged (list row or board card). */
export function beginIssueDrag(ids: readonly string[]): void {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  activeIds = next;
}

/**
 * Clear after the current turn.
 *
 * Some Chromium builds fire `dragend` before `drop`. A sync clear would
 * make the list row see an empty drag and ignore the nest.
 */
export function endIssueDrag(): void {
  queueMicrotask(() => {
    activeIds = [];
  });
}

/** Ids in the current issue drag, or empty when none. */
export function getActiveIssueDragIds(): string[] {
  return activeIds.slice();
}

/** True when this transfer is an issue-row drag (MIME or in-flight descriptor). */
export function dataTransferHasIssueDrag(dataTransfer: DataTransfer | null): boolean {
  if (activeIds.length > 0) return true;
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(ISSUE_DRAG_MIME);
}

/**
 * Ids for this drag: in-flight descriptor first, then MIME on `drop`
 * (getData is empty during dragover).
 */
export function readIssueDragIds(dataTransfer: DataTransfer | null): string[] {
  const live = getActiveIssueDragIds();
  if (live.length > 0) return live;
  if (!dataTransfer) return [];
  let raw = '';
  try {
    raw = dataTransfer.getData(ISSUE_DRAG_MIME).trim();
  } catch {
    return [];
  }
  if (!raw) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Write MIME + plain text and record the in-flight ids.
 *
 * `copyMove` (not `move`) so row `dropEffect` cannot cancel the drop.
 * Chromium rejects a drop when dropEffect is not in effectAllowed.
 */
export function setIssueDragData(transfer: DataTransfer | null, ids: readonly string[]): void {
  beginIssueDrag(ids);
  if (!transfer) return;
  const packed = ids.map((id) => id.trim()).filter(Boolean).join(',');
  try {
    transfer.setData(ISSUE_DRAG_MIME, packed);
  } catch {
    // Some embeds reject custom MIME; text/plain plus the descriptor still work.
  }
  transfer.setData('text/plain', packed);
  transfer.effectAllowed = 'copyMove';
}

/** Reset module state (tests). */
export function resetIssueDragForTests(): void {
  activeIds = [];
}
