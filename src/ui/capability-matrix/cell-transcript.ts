/**
 * Open capability-matrix probe transcript from Settings grid, with the
 * manual-verdict editor folded into the same side panel.
 */

import type { BenchmarkCampaign } from '../../benchmark/campaign-types.ts';
import {
  resolveCapabilityProbeLookup,
  type CapabilityProbeLookup,
} from '../../benchmark/capabilities/cell-transcript.ts';
import type { MergedCapabilityCell } from '../../benchmark/capabilities/merge.ts';
import { getCapabilityById } from '../../benchmark/capabilities/catalog.ts';
import { capabilityMatrixTestId } from '../../benchmark/test-catalog.ts';
import type { TestResult } from '../../benchmark/types.ts';
import {
  openBenchmarkTranscriptDrawer,
  type BenchmarkTranscriptRunMeta,
} from '../benchmark-transcript-drawer.ts';
import { mountCapabilityCellEditor } from './cell-editor.ts';

export type OpenCapabilityCellPanelOptions = {
  campaigns: BenchmarkCampaign[];
  targetLabel: string;
  getInFlightProbeLookup?: (
    targetKey: string,
    capabilityId: string,
  ) => CapabilityProbeLookup | null;
  onSaved: () => void | Promise<void>;
  onClose?: () => void;
};

/** Placeholder result so untested cells still open the panel for manual edits. */
function emptyCapabilityTestResult(cell: MergedCapabilityCell): TestResult {
  const def = getCapabilityById(cell.capabilityId);
  return {
    testId: capabilityMatrixTestId(cell.capabilityId),
    suite: 'capability-matrix',
    label: def?.header ?? cell.capabilityId,
    passed: false,
    skipped: true,
    durationMs: 0,
    score: 0,
    verdict: cell.verdict,
    transcriptMeta: {
      error: 'No probe has run for this cell yet. You can still set a manual verdict.',
    },
  };
}

/**
 * Open the transcript drawer for a matrix cell and mount the verdict editor
 * in the pinned extra slot. Always opens, even when no probe data exists.
 */
export function openCapabilityCellTranscript(
  cell: MergedCapabilityCell,
  options: OpenCapabilityCellPanelOptions,
): void {
  const { campaigns, targetLabel, getInFlightProbeLookup, onSaved, onClose } = options;
  const lookup = resolveCapabilityProbeLookup(
    campaigns,
    cell.targetKey,
    cell.capabilityId,
    getInFlightProbeLookup?.(cell.targetKey, cell.capabilityId) ?? null,
  );

  const def = getCapabilityById(cell.capabilityId);
  const test = lookup?.test ?? emptyCapabilityTestResult(cell);
  const runMeta: BenchmarkTranscriptRunMeta = {
    preset: lookup?.run.preset ?? 'custom',
    modelId: targetLabel,
    startedAt: lookup?.campaignEndedAt ?? cell.autoRanAt ?? 'Not run',
  };

  openBenchmarkTranscriptDrawer(test, runMeta, {
    suiteLabel: def?.header ?? cell.capabilityId,
    onClose,
    mountExtra: (host) =>
      mountCapabilityCellEditor(cell, {
        host,
        targetLabel,
        onSaved,
        embedded: true,
      }),
  });
}
