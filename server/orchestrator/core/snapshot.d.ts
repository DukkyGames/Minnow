import type { BoardState, Snapshot } from './types';

/** Bump when the snapshot shape changes. A mismatch is ignored, never migrated. */
export const SNAPSHOT_VERSION: number;

/** Write a snapshot every this many events. Read by the journal store. */
export const SNAPSHOT_INTERVAL: number;

/** Is this the seq at which a snapshot is due? */
export function shouldSnapshot(seq: number): boolean;

/** JSON-safe canonical form: object keys sorted, Maps as sorted entry arrays. */
export function canonicalise(value: unknown): unknown;

/** Inverse of `canonicalise`. */
export function decanonicalise(value: unknown): unknown;

/** The state as it is written to disk. */
export function stateToJSON(state: BoardState): unknown;

/** A state read back from disk, with empty-state defaults filled in. */
export function stateFromJSON(raw: unknown): BoardState;

/**
 * A stable, order-independent digest that streams rather than building a JSON string first.
 */
export function hashState(value: unknown): string;

/**
 * The digest stored on a snapshot.
 */
export function hashSnapshot(boardId: string, throughSeq: number, state: BoardState): string;

/** Build a snapshot of a state folded through `throughSeq`. */
export function makeSnapshot(boardId: string, state: BoardState, throughSeq: number): Snapshot;

/**
 * Can this snapshot be used to skip part of the fold?
 */
export function isSnapshotUsable(snapshot: unknown, events: readonly unknown[]): boolean;

/**
 * Resume the fold from a snapshot.
 */
export function deriveFrom(snapshot: unknown, events: readonly unknown[]): BoardState;
