/**
 * Resolve latest capability-matrix probe result for transcript drill-down (pure).
 */

import type { BenchmarkCampaign } from '../campaign-types.ts';
import type { BenchmarkRun, TestResult } from '../types.ts';
import {
  parseCapabilityIdFromTestId,
  resolveRunTargetKey,
} from './merge.ts';

export interface CapabilityProbeLookup {
  test: TestResult;
  run: BenchmarkRun;
  campaignId: string;
  campaignEndedAt: string;
}

function testMatchesCell(
  campaign: BenchmarkCampaign,
  run: BenchmarkRun,
  test: TestResult,
  targetKey: string,
  capabilityId: string,
): boolean {
  if (test.suite !== 'capability-matrix') return false;
  const capId = parseCapabilityIdFromTestId(test.testId);
  if (capId !== capabilityId) return false;
  return resolveRunTargetKey(campaign, run) === targetKey;
}

/** Newest campaign run test row for one matrix cell (for fail/partial transcript UI). */
export function findLatestCapabilityProbeResult(
  campaigns: BenchmarkCampaign[],
  targetKey: string,
  capabilityId: string,
): CapabilityProbeLookup | null {
  const sorted = [...campaigns].sort((a, b) =>
    String(b.endedAt ?? b.startedAt).localeCompare(String(a.endedAt ?? a.startedAt)),
  );

  for (const campaign of sorted) {
    for (const run of campaign.runs ?? []) {
      for (const suite of run.suites) {
        if (suite.id !== 'capability-matrix') continue;
        for (const test of suite.tests) {
          if (!testMatchesCell(campaign, run, test, targetKey, capabilityId)) continue;
          return {
            test,
            run,
            campaignId: campaign.id,
            campaignEndedAt: campaign.endedAt ?? campaign.startedAt,
          };
        }
      }
    }
  }
  return null;
}

/** Whether the merged cell should offer probe transcript drill-down. */
export function capabilityCellHasTranscriptDrillDown(
  verdict: string,
  lookup: CapabilityProbeLookup | null,
): boolean {
  if (!lookup) return false;
  if (verdict !== 'fail' && verdict !== 'partial') return false;
  return Boolean(
    lookup.test.transcript?.length ||
      lookup.test.details?.trim() ||
      lookup.test.transcriptMeta?.error,
  );
}
