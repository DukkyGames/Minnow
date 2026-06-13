/**
 * Types for blind model compare sessions and votes.
 */

export type CompareAlias = 'A' | 'B';

export type CompareWinner = 'left' | 'right' | 'tie' | 'both_bad';

export interface CompareModelRef {
  providerId: string;
  modelId: string;
}

export interface CompareStartResponse {
  sessionId: string;
  left: { generationId: string; label: CompareAlias };
  right: { generationId: string; label: CompareAlias };
}

export interface CompareVoteReveal {
  revealed: true;
  left: CompareModelRef;
  right: CompareModelRef;
  winner: CompareWinner;
  assignment: { leftAlias: CompareAlias; rightAlias: CompareAlias };
}

export interface CompareVote {
  id: string;
  startedAt: string;
  completedAt: string;
  prompt: string;
  left: CompareModelRef;
  right: CompareModelRef;
  assignment: { leftAlias: CompareAlias; rightAlias: CompareAlias };
  winner: CompareWinner;
  revealed: boolean;
  notes?: string;
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
