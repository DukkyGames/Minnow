import type { BoardState, Snapshot } from './core/types';

export const SNAPSHOT_INTERVAL: number;

export function boardDir(boardId: string): string;
export function journalPath(boardId: string): string;
export function snapshotPath(boardId: string): string;

/**
 * Read a board's journal. A trailing partial line is dropped silently — a crash
 * mid-append leaves one. A partial line anywhere else throws, because appends
 * are ordered and that means something other than a crash touched the file.
 */
export function readEvents(boardId: string): Promise<Record<string, unknown>[]>;

export function readHighestSeq(boardId: string): Promise<number>;

/**
 * Append one event, assigning `seq` and stamping `ts`. Validated before the
 * write, so an invalid event never reaches disk. Appends are serialised per
 * board, so concurrent callers cannot collide on `seq`.
 */
export function appendEvent(
  boardId: string,
  event: Record<string, unknown>,
  options?: { now?: () => number },
): Promise<Record<string, unknown>>;

/** Append several events as one unit, so nothing can interleave between them. */
export function appendEvents(
  boardId: string,
  events: Record<string, unknown>[],
  options?: { now?: () => number },
): Promise<Record<string, unknown>[]>;

/** Write a snapshot, temp-then-rename. */
export function writeSnapshot(boardId: string, snapshot: Snapshot): Promise<void>;

/** Read the snapshot, or null when there isn't one or it is unreadable. */
export function readSnapshot(boardId: string): Promise<Snapshot | null>;

/** Recompute and write the snapshot from the journal as it now stands. */
export function refreshSnapshot(boardId: string): Promise<void>;

/** The board's state. Always equal to `derive(readEvents(boardId))`. */
export function loadState(boardId: string): Promise<BoardState>;

/** Abandonments reconstructed from the journal alone (MIN-712). */
export function loadAbandonments(
  boardId: string,
): Promise<Array<{ taskId: string; reason: unknown; evidence: import('./core/types').Evidence }>>;

export function createBoard(boardId: string): Promise<void>;
export function boardExists(boardId: string): Promise<boolean>;
/** Remove a board and everything under it — P9-E. False when there was nothing. */
export function deleteBoard(boardId: string): Promise<boolean>;
export function listBoards(): Promise<string[]>;

/** Drop per-process caches. For tests that move MINNOW_HOME between cases. */
export function resetJournalCache(): void;
