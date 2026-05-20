/**
 * Self-healing controller — tier-1 stop/restart on repetition (Step 19).
 */

import { restartSubAgent } from '../orchestrator';
import { DEFAULT_SELF_HEALING_CONFIG } from './defaults';
import { detectRepetition, type ToolCallLogEntry } from './detector';

const tier1Counts = new Map<string, number>();
const tier1Signatures = new Set<string>();

interface SelfHealingConfig {
  enabled: boolean;
  tier1: typeof DEFAULT_SELF_HEALING_CONFIG.tier1;
}

async function loadSelfHealingConfig(): Promise<SelfHealingConfig> {
  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (!res.ok) {
      return { enabled: false, tier1: DEFAULT_SELF_HEALING_CONFIG.tier1 };
    }
    const config = (await res.json()) as { selfHealing?: SelfHealingConfig };
    const row = config.selfHealing;
    if (!row) return { enabled: false, tier1: DEFAULT_SELF_HEALING_CONFIG.tier1 };
    return {
      enabled: row.enabled === true,
      tier1: { ...DEFAULT_SELF_HEALING_CONFIG.tier1, ...row.tier1 },
    };
  } catch {
    return { enabled: false, tier1: DEFAULT_SELF_HEALING_CONFIG.tier1 };
  }
}

/**
 * Observe a sub-agent tool call; may cancel/restart on repetition when enabled.
 */
export function observeSubAgentToolCall(
  runId: string,
  subAgentType: string,
  log: ToolCallLogEntry[],
): void {
  void (async () => {
    const config = await loadSelfHealingConfig();
    if (!config.enabled) return;

    const detection = detectRepetition(log, {
      duplicateToolCallThreshold: config.tier1.duplicateToolCallThreshold,
      sameErrorThreshold: config.tier1.sameErrorThreshold,
    });
    if (!detection) return;

    const restarts = tier1Counts.get(runId) ?? 0;
    if (restarts >= config.tier1.maxRestartsPerParentTurn) return;

    const sigKey = `${subAgentType}:${detection.fingerprint}`;
    const hadTier1 = tier1Signatures.has(sigKey);

    tier1Counts.set(runId, restarts + 1);
    tier1Signatures.add(sigKey);

    const note = hadTier1
      ? `[Self-heal tier 2 deferred] Repeated ${detection.reason}. Avoid the same approach.`
      : `[Self-heal tier 1] You are repeating yourself (${detection.reason}). Stop and try a different approach.`;

    try {
      await restartSubAgent(runId, { note, preserveType: true });
    } catch {
      /* run may have ended */
    }
  })();
}

/** Reset per-run counters (tests). */
export function resetSelfHealingState(): void {
  tier1Counts.clear();
  tier1Signatures.clear();
}
