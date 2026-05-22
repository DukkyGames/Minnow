/**
 * Sub-agent tool log observer (R3 repetition) delegated from the self-healing shim.
 */

import { restartSubAgent } from '../orchestrator.ts';
import { detectRepetition, type ToolCallLogEntry } from '../self-healing/detector.ts';
import { getSupervisorConfigSnapshot } from './config.ts';
import { bumpOrchestratorProgress } from './progress.ts';
import { getRunHealth } from './state.ts';

/**
 * Observe a sub-agent tool call; may restart on repetition when supervisor repetition is enabled.
 */
export function observeSubAgentToolCall(
  runId: string,
  subAgentType: string,
  log: ToolCallLogEntry[],
  parentChatId: string | null | undefined,
): void {
  const h = getRunHealth(runId);
  h.lastToolCallAt = Date.now();
  void (async () => {
    const cfg = getSupervisorConfigSnapshot();
    if (!cfg.enabled || !cfg.repetitionDetection) return;

    const detection = detectRepetition(log, {
      duplicateToolCallThreshold: cfg.repetition.duplicateToolCallThreshold,
      sameErrorThreshold: cfg.repetition.sameErrorThreshold,
    });
    if (!detection) return;

    const h = getRunHealth(runId);
    if (h.restartCount >= cfg.repetition.maxRestartsPerRun) return;

    const sigKey = `${subAgentType}:${detection.fingerprint}`;
    const hadTier1 = h.repetitionFingerprints.has(sigKey);
    h.repetitionFingerprints.add(sigKey);
    h.restartCount += 1;

    const note = hadTier1
      ? `[Supervisor] Repeated ${detection.reason}. Avoid the same approach.`
      : `[Supervisor] You are repeating yourself (${detection.reason}). Stop and try a different approach.`;

    if (parentChatId?.trim()) {
      bumpOrchestratorProgress(parentChatId.trim());
    }

    try {
      await restartSubAgent(runId, { note, preserveType: true });
    } catch {
      /* run may have ended */
    }
  })();
}
