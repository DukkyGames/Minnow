/**
 * Types for blind model compare sessions and votes.
 */

/** Blind label — letters (A, B, …) in parallel mode, numbers (1, 2, …) in sequential. */
export type CompareAlias = string;

/** Winner: screen slot index, legacy left/right (2-up), or shared outcomes. */
export type CompareWinner =
  | number
  | 'left'
  | 'right'
  | 'tie'
  | 'both_bad';

export interface CompareModelRef {
  providerId: string;
  modelId: string;
}

export interface CompareSlotPublic {
  generationId: string;
  label: CompareAlias;
  /** Present once the slot generation has been started (sequential mode). */
  activated?: boolean;
}

export interface CompareStartResponse {
  sessionId: string;
  parallel: boolean;
  slots: CompareSlotPublic[];
  /** @deprecated Use `slots[0]` — kept for backward compatibility. */
  left?: { generationId: string; label: CompareAlias };
  /** @deprecated Use `slots[1]` — kept for backward compatibility. */
  right?: { generationId: string; label: CompareAlias };
}

export interface CompareSlotRef extends CompareModelRef {
  alias: CompareAlias;
}

export interface CompareVoteReveal {
  revealed: true;
  slots: CompareSlotRef[];
  winner: CompareWinner;
  /** @deprecated Use `slots` — kept for 2-up legacy votes. */
  left?: CompareModelRef;
  /** @deprecated Use `slots` — kept for 2-up legacy votes. */
  right?: CompareModelRef;
  /** @deprecated Use `slots[].alias` — kept for 2-up legacy votes. */
  assignment?: { leftAlias: CompareAlias; rightAlias: CompareAlias };
}

export interface CompareVote {
  id: string;
  startedAt: string;
  completedAt: string;
  prompt: string;
  slots: CompareSlotRef[];
  winner: CompareWinner;
  revealed: boolean;
  parallel?: boolean;
  notes?: string;
  /** @deprecated Legacy 2-up shape — normalized at read time when possible. */
  left?: CompareModelRef;
  /** @deprecated Legacy 2-up shape. */
  right?: CompareModelRef;
  /** @deprecated Legacy 2-up shape. */
  assignment?: { leftAlias: CompareAlias; rightAlias: CompareAlias };
}

export interface CompareWinRateRow {
  key: string;
  providerId: string;
  modelId: string;
  wins: number;
  losses: number;
  ties: number;
  bothBad: number;
  total: number;
  winRate: number;
}

/** Minimum and maximum model slots in one compare run. */
export const COMPARE_MIN_SLOTS = 2;
export const COMPARE_MAX_SLOTS = 6;
