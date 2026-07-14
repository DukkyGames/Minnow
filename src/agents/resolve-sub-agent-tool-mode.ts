/**
 * Resolve which parent mode policy applies when a sub-agent runs tools.
 * Plan-family modes are restrictive for the main composer; sub-agents inherit
 * Build-equivalent tool access so reviewers and explorers can read the repo.
 */

import { normalizeModeId, type ModeId } from '../chat/modes/types';

/** Tool policy mode for sub-agent runs (spawn input may still record the parent mode). */
export function resolveSubAgentToolModeId(modeId: string | null | undefined): ModeId {
  const normalized = normalizeModeId(modeId);
  if (normalized === 'super-plan' || normalized === 'plan') {
    return 'build';
  }
  return normalized;
}
