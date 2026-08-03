/**
 * Single source of truth for agent supervision thresholds (heartbeat interval H,
 * progress stall P, heartbeat-dead D).
 *
 * These drive the sub-agent watchdog *and* orchestrate board task chats, which both
 * write the one `heartbeatConfig` singleton in agents/controller/wrapper. They used to
 * be read from two different stores — sub-agents.json for sub-agents, the config.json
 * `autopilot` block for boards — so whichever subsystem dispatched last silently won,
 * and the Autopilot sliders never took effect for sub-agents. Everything resolves here
 * now, and sub-agents.json is the only place these are written.
 *
 * The `autopilot` block is still read as a fallback so values saved before the stores
 * merged keep applying until they are next changed.
 */

import DEFAULTS from '../agents/defaults/sub-agents.json';
import {
  clampHeartbeatDeadMs,
  clampHeartbeatIntervalMs,
  clampProgressStallMs,
  getSubAgentUserOverridesSync,
  loadSubAgentConfig,
  saveSubAgentConfigToServer,
} from '../agents/sub-agent-config';
import type { SubAgentsFile } from '../agents/types';
import { DEFAULT_AUTOPILOT_META, getAutopilotMetaSync } from './autopilot-meta';

export interface SupervisionThresholds {
  /** How often a running agent reports liveness. */
  heartbeatIntervalMs: number;
  /** No observable progress for this long marks the run suspect. */
  progressStallMs: number;
  /** No heartbeat for this long treats the run as dead. */
  heartbeatDeadMs: number;
}

const SHIPPED = DEFAULTS as SubAgentsFile;

export const DEFAULT_SUPERVISION_THRESHOLDS: SupervisionThresholds = {
  heartbeatIntervalMs: clampHeartbeatIntervalMs(SHIPPED.heartbeatIntervalMs),
  progressStallMs: clampProgressStallMs(SHIPPED.progressStallMs),
  heartbeatDeadMs: clampHeartbeatDeadMs(SHIPPED.heartbeatDeadMs),
};

/**
 * Legacy `autopilot` value for a threshold, or null when it was never changed.
 * DEFAULT_AUTOPILOT_META mirrors the shipped defaults, so equality means "untouched".
 */
function legacyAutopilotValue(key: keyof SupervisionThresholds): number | null {
  const value = getAutopilotMetaSync()[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value === DEFAULT_AUTOPILOT_META[key]) return null;
  return value;
}

/**
 * Effective thresholds: sub-agents.json override → legacy autopilot value → shipped
 * default. Sync; callers that need fresh data should await {@link loadSupervisionThresholds}.
 */
export function resolveSupervisionThresholds(): SupervisionThresholds {
  const user = getSubAgentUserOverridesSync();
  return {
    heartbeatIntervalMs: clampHeartbeatIntervalMs(
      user?.heartbeatIntervalMs ??
        legacyAutopilotValue('heartbeatIntervalMs') ??
        DEFAULT_SUPERVISION_THRESHOLDS.heartbeatIntervalMs,
      DEFAULT_SUPERVISION_THRESHOLDS.heartbeatIntervalMs,
    ),
    progressStallMs: clampProgressStallMs(
      user?.progressStallMs ??
        legacyAutopilotValue('progressStallMs') ??
        DEFAULT_SUPERVISION_THRESHOLDS.progressStallMs,
      DEFAULT_SUPERVISION_THRESHOLDS.progressStallMs,
    ),
    heartbeatDeadMs: clampHeartbeatDeadMs(
      user?.heartbeatDeadMs ??
        legacyAutopilotValue('heartbeatDeadMs') ??
        DEFAULT_SUPERVISION_THRESHOLDS.heartbeatDeadMs,
      DEFAULT_SUPERVISION_THRESHOLDS.heartbeatDeadMs,
    ),
  };
}

/** Prime the sub-agents config cache, then resolve. */
export async function loadSupervisionThresholds(): Promise<SupervisionThresholds> {
  await loadSubAgentConfig();
  return resolveSupervisionThresholds();
}

/** Persist thresholds to sub-agents.json (the only writable store). */
export async function saveSupervisionThresholds(
  patch: Partial<SupervisionThresholds>,
): Promise<SupervisionThresholds> {
  const current = await loadSubAgentConfig();
  const next = { ...current };

  if (patch.heartbeatIntervalMs !== undefined) {
    next.heartbeatIntervalMs = clampHeartbeatIntervalMs(
      patch.heartbeatIntervalMs,
      DEFAULT_SUPERVISION_THRESHOLDS.heartbeatIntervalMs,
    );
  }
  if (patch.progressStallMs !== undefined) {
    next.progressStallMs = clampProgressStallMs(
      patch.progressStallMs,
      DEFAULT_SUPERVISION_THRESHOLDS.progressStallMs,
    );
  }
  if (patch.heartbeatDeadMs !== undefined) {
    next.heartbeatDeadMs = clampHeartbeatDeadMs(
      patch.heartbeatDeadMs,
      DEFAULT_SUPERVISION_THRESHOLDS.heartbeatDeadMs,
    );
  }

  const ok = await saveSubAgentConfigToServer(next);
  if (!ok) throw new Error('Could not save supervision thresholds');
  return resolveSupervisionThresholds();
}
