/** Boards journal binding onto namespace boards. */

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
