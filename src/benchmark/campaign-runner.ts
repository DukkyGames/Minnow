/**
 * Multi-model benchmark campaign orchestration.
 */

import { fetchEvalConfig } from '../evals/config.ts';
import { runEvalSuite } from '../evals/suite-scheduler.ts';
import { resolveProvider } from '../providers/store.ts';
import { getWorkspacePath } from '../state/workspace.ts';
import { aggregateFromRun, computeCampaignAggregates } from './aggregates.ts';
import { isAbortError, benchmarkAbortError } from './abort.ts';
import type {
  BenchmarkCampaign,
  BenchmarkCellResult,
  BenchmarkTarget,
  RunCampaignOptions,
  SelectedSuite,
} from './campaign-types.ts';
import { runMatrix } from './matrix-scheduler.ts';
import { buildTargetKey, targetKeyFromTarget, targetLabel } from './model-key.ts';
import { runBenchmark } from './runner.ts';
import { runStandardPackForTarget } from './standard/runner.ts';
import type { SuiteId } from './types.ts';
import { saveCampaign } from './campaign-persistence.ts';

const QUICK_SUITES: SuiteId[] = ['capability', 'speed'];
const FULL_SUITES: SuiteId[] = [
  'capability',
  'speed',
  'tools',
  'skills',
  'coding',
];

function newCampaignId(): string {
  return `campaign-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function suitesForPreset(
  preset: RunCampaignOptions['preset'],
  override?: SuiteId[],
): SuiteId[] {
  if (override?.length) return override;
  return preset === 'full' ? FULL_SUITES : QUICK_SUITES;
}

function buildSelectedSuites(options: RunCampaignOptions): SelectedSuite[] {
  const suites: SelectedSuite[] = [];
  const integration = options.integrationSuites ?? suitesForPreset(options.preset ?? 'quick');
  for (const id of integration) {
    suites.push({ family: 'integration', id });
  }
  for (const id of options.standardPackIds ?? []) {
    suites.push({
      family: 'standard',
      id,
      tier: options.standardTier ?? 'mini',
    });
  }
  for (const id of options.customPackIds ?? []) {
    suites.push({ family: 'custom', id });
  }
  return suites;
}

interface TargetWorkResult {
  target: BenchmarkTarget;
  runs: import('./types.ts').BenchmarkRun[];
  cells: BenchmarkCellResult[];
}

async function runIntegrationForTarget(
  target: BenchmarkTarget,
  suiteIds: SuiteId[],
  preset: RunCampaignOptions['preset'],
  signal: AbortSignal,
  onProgress: RunCampaignOptions['onProgress'],
): Promise<TargetWorkResult> {
  const targetKey = targetKeyFromTarget(target);
  const provider = await resolveProvider(target.providerId);
  const run = await runBenchmark({
    suites: suiteIds,
    preset: preset ?? 'custom',
    signal,
    saveToHistory: true,
    binding: {
      providerId: provider.id,
      modelId: target.modelId,
      provider,
    },
    onProgress: (event) => {
      onProgress?.({ type: 'integration-progress', targetKey, event });
      if (event.type === 'test-done' && event.result.tokPerSec) {
        onProgress?.({
          type: 'metric-sample',
          targetKey,
          tokPerSec: event.result.tokPerSec,
          ttftMs: event.result.ttftMs,
        });
      }
    },
  });
  return { target, runs: [run], cells: [] };
}

async function runStandardForTarget(
  target: BenchmarkTarget,
  packIds: string[],
  tier: RunCampaignOptions['standardTier'],
  signal: AbortSignal,
  onProgress: RunCampaignOptions['onProgress'],
): Promise<TargetWorkResult> {
  const cells: BenchmarkCellResult[] = [];
  for (const packId of packIds) {
    if (signal.aborted) break;
    const packCells = await runStandardPackForTarget({
      target,
      packId,
      tier: tier ?? 'mini',
      signal,
      onItemDone: (cell) => {
        onProgress?.({ type: 'cell-done', cell });
        if (cell.tokPerSec) {
          onProgress?.({
            type: 'metric-sample',
            targetKey: cell.targetKey,
            tokPerSec: cell.tokPerSec,
            ttftMs: cell.ttftMs,
          });
        }
      },
    });
    cells.push(...packCells);
  }
  return { target, runs: [], cells };
}

/** Run a multi-model benchmark campaign. */
export async function runBenchmarkCampaign(
  options: RunCampaignOptions,
): Promise<BenchmarkCampaign> {
  const targets = options.targets;
  if (!targets.length) {
    throw new Error('Select at least one model for the benchmark campaign.');
  }

  const signal = options.signal ?? new AbortController().signal;
  const onProgress = options.onProgress;
  const campaignId = newCampaignId();
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const integrationSuites = options.integrationSuites ?? suitesForPreset(options.preset ?? 'quick');
  const standardPackIds = options.standardPackIds ?? [];
  const customPackIds = options.customPackIds ?? [];
  const selectedSuites = buildSelectedSuites(options);

  let configConcurrency = 2;
  try {
    const config = await fetchEvalConfig();
    configConcurrency = config.maxConcurrency;
  } catch {
    /* offline */
  }
  const concurrency = Math.max(
    1,
    Math.min(8, options.maxConcurrency ?? configConcurrency),
  );

  onProgress?.({
    type: 'campaign-start',
    campaignId,
    targetCount: targets.length,
  });
  onProgress?.({ type: 'phase', phase: 'planning', label: 'Planning campaign…' });
  onProgress?.({ type: 'phase', phase: 'warming', label: 'Warming models…' });
  onProgress?.({ type: 'phase', phase: 'running', label: 'Running suites…' });

  const allRuns: import('./types.ts').BenchmarkRun[] = [];
  const allCells: BenchmarkCellResult[] = [];

  const workItems = targets.map((target) => ({
    id: targetKeyFromTarget(target),
    payload: target,
  }));

  try {
    await runMatrix<BenchmarkTarget, TargetWorkResult>({
      items: workItems,
      concurrency,
      signal,
      onItemStart: (item) => {
        onProgress?.({
          type: 'target-start',
          targetKey: item.id,
          label: targetLabel(item.payload),
        });
      },
      worker: async ({ item, signal: workerSignal }) => {
        const target = item.payload;
        const parts: TargetWorkResult[] = [];

        if (integrationSuites.length) {
          parts.push(
            await runIntegrationForTarget(
              target,
              integrationSuites,
              options.preset,
              workerSignal,
              onProgress,
            ),
          );
        }

        if (standardPackIds.length) {
          parts.push(
            await runStandardForTarget(
              target,
              standardPackIds,
              options.standardTier,
              workerSignal,
              onProgress,
            ),
          );
        }

        const runs = parts.flatMap((p) => p.runs);
        const cells = parts.flatMap((p) => p.cells);
        return { target, runs, cells };
      },
      onItemDone: (item, result: TargetWorkResult) => {
        allRuns.push(...result.runs);
        allCells.push(...result.cells);
        const agg = result.runs[0]
          ? aggregateFromRun(result.target, result.runs[0], result.cells)
          : computeCampaignAggregates({
              targets: [result.target],
              cells: result.cells,
              runs: [],
            })[0]!;
        onProgress?.({
          type: 'target-done',
          targetKey: item.id,
          aggregate: agg,
        });
      },
    });

    if (customPackIds.length && !signal.aborted) {
      for (const packId of customPackIds) {
        await runEvalSuite({
          request: {
            packId,
            targets: targets.map((t) => ({
              providerId: t.providerId,
              modelId: t.modelId,
              label: t.label,
            })),
          },
          defaultWorkspacePath: getWorkspacePath(),
          fallbackProviderId: targets[0]!.providerId,
          fallbackModelId: targets[0]!.modelId,
        });
      }
    }

    if (signal.aborted) {
      throw benchmarkAbortError(signal);
    }

    onProgress?.({ type: 'phase', phase: 'aggregating', label: 'Aggregating results…' });

    const campaign: BenchmarkCampaign = {
      id: campaignId,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - t0),
      preset: options.preset ?? 'custom',
      targets,
      suites: selectedSuites,
      status: 'completed',
      cells: allCells,
      runs: allRuns,
      aggregates: computeCampaignAggregates({
        targets,
        cells: allCells,
        runs: allRuns,
      }),
    };

    await saveCampaign(campaign);
    onProgress?.({ type: 'phase', phase: 'done', label: 'Done' });
    onProgress?.({ type: 'campaign-done', campaign });
    return campaign;
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      const partial: BenchmarkCampaign = {
        id: campaignId,
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - t0),
        preset: options.preset ?? 'custom',
        targets,
        suites: selectedSuites,
        status: 'cancelled',
        cells: allCells,
        runs: allRuns,
        aggregates: computeCampaignAggregates({
          targets,
          cells: allCells,
          runs: allRuns,
        }),
      };
      if (options.persistPartialOnCancel) {
        await saveCampaign(partial);
      }
      onProgress?.({ type: 'campaign-cancelled', campaign: partial });
      throw err;
    }
    throw err;
  }
}

export function buildTargetKeyForCampaign(target: BenchmarkTarget): string {
  return buildTargetKey(target.providerId, target.modelId);
}
