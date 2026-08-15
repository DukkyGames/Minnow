/**
 * Open capability-matrix probe transcript from Settings grid, with the
 * manual-verdict editor folded into the same side panel.
 */

import type { BenchmarkCampaign } from '../../benchmark/campaign-types.ts';
import {
  resolveCapabilityProbeLookup,
  type CapabilityProbeLookup,
} from '../../benchmark/capabilities/cell-transcript.ts';
import type { MatrixCurrentProbe } from '../../benchmark/capabilities/matrix-run-controller.ts';
import type { MergedCapabilityCell } from '../../benchmark/capabilities/merge.ts';
import { getCapabilityById } from '../../benchmark/capabilities/catalog.ts';
import { capabilityMatrixTestId } from '../../benchmark/test-catalog.ts';
import type { TestResult } from '../../benchmark/types.ts';
import {
  isBenchmarkTranscriptDrawerOpen,
  openBenchmarkTranscriptDrawer,
  updateBenchmarkTranscriptDrawer,
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
  getCurrentProbe?: () => MatrixCurrentProbe | null;
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

/** Synthetic result while a probe is still running. */
export function syntheticRunningCapabilityResult(
  capabilityId: string,
  label: string,
): TestResult {
  return {
    testId: capabilityMatrixTestId(capabilityId),
    suite: 'capability-matrix',
    label,
    passed: false,
    skipped: false,
    durationMs: 0,
    score: 0,
    transcriptMeta: {
      error: 'Probe is running. The transcript will appear here when it finishes.',
    },
  };
}

/** Synthetic result when a sweep was stopped before the probe finished. */
export function syntheticStoppedCapabilityResult(
  capabilityId: string,
  label: string,
): TestResult {
  return {
    testId: capabilityMatrixTestId(capabilityId),
    suite: 'capability-matrix',
    label,
    passed: false,
    skipped: false,
    durationMs: 0,
    score: 0,
    details: 'Capability matrix sweep was stopped during this probe.',
    transcriptMeta: {
      error: 'No transcript — the sweep was stopped before this probe finished.',
    },
  };
}

function isProbeRunningForCell(
  cell: MergedCapabilityCell,
  getCurrentProbe?: () => MatrixCurrentProbe | null,
): boolean {
  const current = getCurrentProbe?.();
  return (
    current?.targetKey === cell.targetKey && current?.capabilityId === cell.capabilityId
  );
}

function resolveCellTest(
  cell: MergedCapabilityCell,
  targetLabel: string,
  campaigns: BenchmarkCampaign[],
  getInFlightProbeLookup: OpenCapabilityCellPanelOptions['getInFlightProbeLookup'],
  getCurrentProbe: OpenCapabilityCellPanelOptions['getCurrentProbe'],
): { test: TestResult; runMeta: BenchmarkTranscriptRunMeta; running: boolean } {
  const def = getCapabilityById(cell.capabilityId);
  const label = def?.header ?? cell.capabilityId;
  const lookup = resolveCapabilityProbeLookup(
    campaigns,
    cell.targetKey,
    cell.capabilityId,
    getInFlightProbeLookup?.(cell.targetKey, cell.capabilityId) ?? null,
  );

  if (lookup) {
    return {
      test: lookup.test,
      runMeta: {
        preset: lookup.run.preset,
        modelId: targetLabel,
        startedAt: lookup.campaignEndedAt,
      },
      running: false,
    };
  }

  if (isProbeRunningForCell(cell, getCurrentProbe)) {
    return {
      test: syntheticRunningCapabilityResult(cell.capabilityId, label),
      runMeta: {
        preset: 'custom',
        modelId: targetLabel,
        startedAt: 'Running…',
      },
      running: true,
    };
  }

  return {
    test: emptyCapabilityTestResult(cell),
    runMeta: {
      preset: 'custom',
      modelId: targetLabel,
      startedAt: cell.autoRanAt ?? 'Not run',
    },
    running: false,
  };
}

function mountCellEditorExtra(
  cell: MergedCapabilityCell,
  targetLabel: string,
  onSaved: () => void | Promise<void>,
  probeRunning: boolean,
): (host: HTMLElement) => () => void {
  return (host) =>
    mountCapabilityCellEditor(cell, {
      host,
      targetLabel,
      onSaved,
      embedded: true,
      saveDisabled: probeRunning,
    });
}

/**
 * Open the transcript drawer for a matrix cell and mount the verdict editor
 * in the pinned extra slot. Always opens, even when no probe data exists.
 */
export function openCapabilityCellTranscript(
  cell: MergedCapabilityCell,
  options: OpenCapabilityCellPanelOptions,
): void {
  const { campaigns, targetLabel, getInFlightProbeLookup, getCurrentProbe, onSaved, onClose } =
    options;
  const def = getCapabilityById(cell.capabilityId);
  const { test, runMeta, running } = resolveCellTest(
    cell,
    targetLabel,
    campaigns,
    getInFlightProbeLookup,
    getCurrentProbe,
  );

  const displayMeta: BenchmarkTranscriptRunMeta = runMeta;

  openBenchmarkTranscriptDrawer(test, displayMeta, {
    suiteLabel: def?.header ?? cell.capabilityId,
    running,
    onClose,
    mountExtra: mountCellEditorExtra(cell, targetLabel, onSaved, running),
  });
}

/**
 * Refresh the open drawer when a probe completes or the sweep is cancelled
 * while the user is watching that cell.
 */
export function refreshCapabilityCellTranscript(
  cell: MergedCapabilityCell,
  options: OpenCapabilityCellPanelOptions & {
    /** When true, show stopped copy if the probe never produced a lookup. */
    sweepCancelled?: boolean;
  },
): void {
  if (!isBenchmarkTranscriptDrawerOpen()) return;

  const {
    campaigns,
    targetLabel,
    getInFlightProbeLookup,
    getCurrentProbe,
    onSaved,
    sweepCancelled,
  } = options;
  const def = getCapabilityById(cell.capabilityId);
  const label = def?.header ?? cell.capabilityId;

  if (isProbeRunningForCell(cell, getCurrentProbe)) {
    const runningTest = syntheticRunningCapabilityResult(cell.capabilityId, label);
    updateBenchmarkTranscriptDrawer(
      runningTest,
      { preset: 'custom', modelId: targetLabel, startedAt: 'Running…' },
      {
        suiteLabel: label,
        running: true,
        mountExtra: mountCellEditorExtra(cell, targetLabel, onSaved, true),
      },
    );
    return;
  }

  const lookup = resolveCapabilityProbeLookup(
    campaigns,
    cell.targetKey,
    cell.capabilityId,
    getInFlightProbeLookup?.(cell.targetKey, cell.capabilityId) ?? null,
  );

  if (lookup) {
    updateBenchmarkTranscriptDrawer(
      lookup.test,
      {
        preset: lookup.run.preset,
        modelId: targetLabel,
        startedAt: lookup.campaignEndedAt,
      },
      {
        suiteLabel: label,
        running: false,
        mountExtra: mountCellEditorExtra(cell, targetLabel, onSaved, false),
      },
    );
    return;
  }

  if (sweepCancelled) {
    updateBenchmarkTranscriptDrawer(
      syntheticStoppedCapabilityResult(cell.capabilityId, label),
      { preset: 'custom', modelId: targetLabel, startedAt: 'Stopped' },
      {
        suiteLabel: label,
        running: false,
        mountExtra: mountCellEditorExtra(cell, targetLabel, onSaved, false),
      },
    );
  }
}
