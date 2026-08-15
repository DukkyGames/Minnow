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

/** Build a transcript lookup from an in-flight probe (before campaign save). */
export function capabilityProbeLookupFromTest(
  test: TestResult,
  campaignId: string,
  campaignEndedAt?: string,
): CapabilityProbeLookup {
  const endedAt = campaignEndedAt ?? new Date().toISOString();
  return {
    test,
    run: {
      id: 'in-flight',
      startedAt: endedAt,
      durationMs: test.durationMs,
      preset: 'custom',
      provider: { id: 'in-flight', baseUrl: '' },
      model: { id: 'in-flight' },
      totalScore: 0,
      headlineTokPerSec: 0,
      headlineTtftMs: 0,
      modeMatrixPassed: 0,
      toolsPassed: 0,
      skillsPassed: 0,
      suites: [],
    },
    campaignId,
    campaignEndedAt: endedAt,
  };
}

/** Newest campaign run test row for one matrix cell (transcript drill-down). */
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

/** Prefer in-flight probe data (active sweep) over the latest saved campaign row. */
export function resolveCapabilityProbeLookup(
  campaigns: BenchmarkCampaign[],
  targetKey: string,
  capabilityId: string,
  inFlight?: CapabilityProbeLookup | null,
): CapabilityProbeLookup | null {
  if (inFlight) return inFlight;
  return findLatestCapabilityProbeResult(campaigns, targetKey, capabilityId);
}

/** Whether the merged cell should offer probe transcript drill-down. */
export function capabilityCellHasTranscriptDrillDown(
  lookup: CapabilityProbeLookup | null,
): boolean {
  return lookup != null;
}
