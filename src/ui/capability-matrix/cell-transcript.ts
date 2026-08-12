/**
 * Open capability-matrix probe transcript from Settings grid / cell editor.
 */

import type { BenchmarkCampaign } from '../../benchmark/campaign-types.ts';
import {
  capabilityCellHasTranscriptDrillDown,
  resolveCapabilityProbeLookup,
  type CapabilityProbeLookup,
} from '../../benchmark/capabilities/cell-transcript.ts';
import type { MergedCapabilityCell } from '../../benchmark/capabilities/merge.ts';
import { getCapabilityById } from '../../benchmark/capabilities/catalog.ts';
import {
  openBenchmarkTranscriptDrawer,
  type BenchmarkTranscriptRunMeta,
} from '../benchmark-transcript-drawer.ts';

/** Open the shared transcript drawer when a cell has probe data. */
export function openCapabilityCellTranscript(
  cell: MergedCapabilityCell,
  campaigns: BenchmarkCampaign[],
  targetLabel: string,
  getInFlightProbeLookup?: (
    targetKey: string,
    capabilityId: string,
  ) => CapabilityProbeLookup | null,
): boolean {
  const lookup = resolveCapabilityProbeLookup(
    campaigns,
    cell.targetKey,
    cell.capabilityId,
    getInFlightProbeLookup?.(cell.targetKey, cell.capabilityId) ?? null,
  );
  if (!capabilityCellHasTranscriptDrillDown(lookup) || !lookup) return false;

  const def = getCapabilityById(cell.capabilityId);
  const runMeta: BenchmarkTranscriptRunMeta = {
    preset: lookup.run.preset,
    modelId: targetLabel,
    startedAt: lookup.campaignEndedAt,
  };
  openBenchmarkTranscriptDrawer(
    lookup.test,
    runMeta,
    { suiteLabel: def?.header ?? cell.capabilityId },
  );
  return true;
}
