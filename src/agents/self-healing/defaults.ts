/**
 * Default self-healing config (off by default until Step 20 toggle).
 */

export const DEFAULT_SELF_HEALING_CONFIG = {
  enabled: false,
  tier1: {
    maxRestartsPerParentTurn: 2,
    duplicateToolCallThreshold: 3,
    sameErrorThreshold: 3,
    noProgressTurnThreshold: 4,
  },
  tier2: {
    enabled: true,
    requireScriptApproval: true,
    maxExplorerTurns: 12,
    maxSkillBytes: 65536,
    maxScriptsOnDisk: 50,
  },
  signatureWindow: {
    parentTurn: true,
    sessionMinutes: 60,
  },
};
