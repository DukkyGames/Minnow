/**
 * Build capability-matrix resume payloads from persisted campaigns (run history).
 */

import type { ActiveCapabilityMatrixRunPayload } from '../active-run-session.ts';
import type { BenchmarkCampaign } from '../campaign-types.ts';
import { targetKeyFromTarget } from '../model-key.ts';
import {
  parseCapabilityIdFromTestId,
  resolveRunTargetKey,
} from './merge.ts';

/** Whether a cancelled sweep still has targets or probes left to run. */
export function canResumeCapabilityMatrixCampaign(
  campaign: BenchmarkCampaign,
): boolean {
  return buildResumePayloadFromCampaign(campaign) != null;
}

/** Resume payload for {@link startCapabilityMatrixRun} from a saved campaign row. */
export function buildResumePayloadFromCampaign(
  campaign: BenchmarkCampaign,
): ActiveCapabilityMatrixRunPayload | null {
  if (campaign.kind !== 'capability-matrix') return null;
  if (campaign.status !== 'cancelled') return null;
  if (!campaign.targets.length) return null;

  const completedTargetKeys: string[] = [];
  const completedProbeKeys: string[] = [];

  for (const run of campaign.runs ?? []) {
    const targetKey = resolveRunTargetKey(campaign, run);
    if (!completedTargetKeys.includes(targetKey)) {
      completedTargetKeys.push(targetKey);
    }
    for (const suite of run.suites) {
      if (suite.id !== 'capability-matrix') continue;
      for (const test of suite.tests) {
        const capabilityId = parseCapabilityIdFromTestId(test.testId);
        if (!capabilityId) continue;
        completedProbeKeys.push(`${targetKey}::${capabilityId}`);
      }
    }
  }

  for (const skipped of campaign.skippedTargets ?? []) {
    if (!completedTargetKeys.includes(skipped.targetKey)) {
      completedTargetKeys.push(skipped.targetKey);
    }
  }

  const remaining = campaign.targets.filter(
    (target) =>
      !completedTargetKeys.includes(targetKeyFromTarget(target)),
  );
  if (!remaining.length) return null;

  return {
    campaignId: campaign.id,
    targets: campaign.targets,
    completedTargetKeys,
    completedProbeKeys,
    allowSideEffects: false,
    skipScored: true,
    groupIds: null,
    probeWaves: null,
    manageModelLifecycle: false,
  };
}
