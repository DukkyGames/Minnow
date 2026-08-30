import type { BoardState, SeedKind } from './core/types';

/** The six kinds, in the order the policy table names them. */
export const SEED_KINDS: readonly SeedKind[];

/**
 * Build the user-message seed for one attempt.
 *
 * Pure: same `kind` + derived state always produce the same string. No I/O,
 * no model call. Throws if `taskId` is missing from the state or `kind` is
 * unknown — a wiring mistake should fail loudly, not silently reseed wrong.
 */
export function buildSeed(
  kind: SeedKind,
  input: {
    state: BoardState;
    taskId: string;
  },
): string;
