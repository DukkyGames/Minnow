/**
 * Send-path rules for Orchestrate mode (plan required before user content or attachments).
 */

import { normalizeModeId, type ModeId } from '../modes/types';

/** Default user line when the composer is empty but a plan is selected. */
export const ORCHESTRATE_DEFAULT_USER_MESSAGE = 'Execute the selected plan.';

/**
 * When the user is attempting a send in Orchestrate without a plan, the caller should block.
 * Returns `idle` when there is nothing to send (no text, no attachments).
 */
export function orchestrateRequiresPlanBlock(
  modeId: ModeId | string | undefined,
  planPath: string | undefined,
  rawTextTrimmed: string,
  pendingNonErrorCount: number,
): 'idle' | 'block' {
  const mode = normalizeModeId(modeId);
  if (mode !== 'orchestrate') return 'idle';
  if (planPath?.trim()) return 'idle';
  if (!rawTextTrimmed && pendingNonErrorCount === 0) return 'idle';
  return 'block';
}

/**
 * Text passed to slash parsing: composer text, or default message when Orchestrate has a plan and input is empty.
 */
export function resolveOrchestrateSlashInput(
  modeId: ModeId | string | undefined,
  planPath: string | undefined,
  rawTextTrimmed: string,
): string {
  const mode = normalizeModeId(modeId);
  if (mode !== 'orchestrate' || !planPath?.trim()) return rawTextTrimmed;
  if (rawTextTrimmed) return rawTextTrimmed;
  return ORCHESTRATE_DEFAULT_USER_MESSAGE;
}
