/**
 * Shared result type for standard benchmark harness scoring.
 */

export interface StandardScoreResult {
  passed: boolean;
  score: number;
  details?: string;
}
