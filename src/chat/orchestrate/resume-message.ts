/**
 * Shared resume copy for Orchestrate board Resume and stall watchdog auto-recovery.
 */

import type { OrchestrateBoardState } from '../../types.ts';
import {
  canOrchestrateResume,
  ORCHESTRATE_PLAN_COMPLETE_RESUME_HINT,
} from './plan-complete.ts';

export const ORCHESTRATE_RESUME_MESSAGE =
  "Resume the plan. Call board_get_state and continue from the first task whose status is not 'complete'.";

/** Resume message when work remains; null when the plan is already complete. */
export function resolveOrchestrateResumeMessage(
  board: OrchestrateBoardState | null | undefined,
): string | null {
  if (!board || !canOrchestrateResume(board)) return null;
  return ORCHESTRATE_RESUME_MESSAGE;
}

export { ORCHESTRATE_PLAN_COMPLETE_RESUME_HINT };
