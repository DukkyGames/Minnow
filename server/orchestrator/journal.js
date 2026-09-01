/**
 * P1-A — the **boards** journal binding.
 *
 * The generic store lives in {@link ./journal-store.js}. This module keeps the
 * Phase 1–5 exported names (`boardDir`, `journalPath`, `createBoard`,
 * `loadState`, …) as a thin binding onto namespace `'boards'`, so a board
 * created before P8-B still loads from exactly
 * `~/.minnow/boards/<id>/journal.jsonl`. Changing that path is not free: the
 * journal is the only record of every run to date.
 *
 * Fold and validation stay the board graph (`derive` / `validateEvent`) here.
 * A second graph passes its own fold into `createJournalStore`.
 */

import { derive } from './core/derive.js';
import { queryAbandonments } from './core/evidence.js';
import { validateEvent } from './core/events.js';
import {
  deriveFrom,
  isSnapshotUsable,
  makeSnapshot,
  SNAPSHOT_INTERVAL,
  shouldSnapshot,
} from './core/snapshot.js';
import { BOARDS_NAMESPACE, createJournalStore } from './journal-store.js';

const boards = createJournalStore({
  namespace: BOARDS_NAMESPACE,
  // Keep the historical error text (`invalid board id`) — tests and HTTP 400s
  // quote it, and a rename would look like a behaviour change.
  idKind: 'board',
  fold: derive,
  foldFrom: deriveFrom,
  isSnapshotUsable,
  makeSnapshot,
  shouldSnapshot,
  validate: validateEvent,
  queryAbandonments,
});

/** @param {string} boardId */
export function boardDir(boardId) {
  return boards.entryDir(boardId);
}

/** @param {string} boardId */
export function journalPath(boardId) {
  return boards.journalPath(boardId);
}

/** @param {string} boardId */
export function snapshotPath(boardId) {
  return boards.snapshotPath(boardId);
}

export const readEvents = boards.readEvents;
export const readHighestSeq = boards.readHighestSeq;
export const appendEvent = boards.appendEvent;
export const appendEvents = boards.appendEvents;
export const writeSnapshot = boards.writeSnapshot;
export const readSnapshot = boards.readSnapshot;
export const refreshSnapshot = boards.refreshSnapshot;
export const loadState = boards.loadState;
export const loadAbandonments = boards.loadAbandonments;
export const createBoard = boards.createEntry;
export const boardExists = boards.entryExists;
export const deleteBoard = boards.deleteEntry;
export const listBoards = boards.listEntries;
export const resetJournalCache = boards.resetCache;

export { SNAPSHOT_INTERVAL };
