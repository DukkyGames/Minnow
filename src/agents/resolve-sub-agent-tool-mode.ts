import { normalizeModeId, type ModeId } from '../chat/modes/types';

export function resolveSubAgentToolModeId(modeId: string | null | undefined): ModeId {
  const normalized = normalizeModeId(modeId);
  if (normalized === 'super-plan' || normalized === 'plan') {
    return 'build';
  }
  return normalized;
}
