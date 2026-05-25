/**
 * Benchmark runner: suite orchestration, progress events, aggregation.
 */

import { detectLocalServer } from '../tools/client';
import {
  assertNotAborted,
  benchmarkAbortError,
  isAbortError,
} from './abort.ts';
import { aggregateRunScore } from './scoring.ts';
import { resolveBenchmarkBinding } from './resolve-binding.ts';
import { saveRun } from './persistence.ts';
import { runCapabilitySuite } from './suites/capability.ts';
import { runSpeedSuite } from './suites/speed.ts';
import { runToolsSuite } from './suites/tools.ts';
import { runSkillsSuite } from './suites/skills.ts';
import { runModesSuite } from './suites/modes.ts';
import { runCodingSuite } from './suites/coding.ts';
import type {
  BenchmarkPreset,
  BenchmarkRun,
  BenchmarkRunContext,
  BenchmarkProgressEvent,
  RunBenchmarkOptions,
  SuiteId,
  SuiteResult,
} from './types.ts';

const QUICK_SUITES: SuiteId[] = ['capability', 'speed', 'modes'];
const FULL_SUITES: SuiteId[] = [
  'capability',
  'speed',
  'tools',
  'skills',
  'modes',
  'coding',
];

function suitesForPreset(preset: BenchmarkPreset, override?: SuiteId[]): SuiteId[] {
  if (override?.length) return override;
  return preset === 'full' ? FULL_SUITES : QUICK_SUITES;
}

/** Suite order for a preset (used by benchmark UI before a run starts). */
export function resolveBenchmarkSuites(
  preset: BenchmarkPreset,
  override?: SuiteId[],
): SuiteId[] {
  return suitesForPreset(preset, override);
}

function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function suiteLabel(suiteId: SuiteId): string {
  if (suiteId === 'capability') return 'Capability';
  if (suiteId === 'speed') return 'Speed';
  if (suiteId === 'tools') return 'Tools';
  if (suiteId === 'skills') return 'Skills';
  if (suiteId === 'modes') return 'Modes';
  return 'Coding';
}

function emitTestResults(
  suite: SuiteResult,
  onProgress: ((event: BenchmarkProgressEvent) => void) | undefined,
  signal: AbortSignal,
): void {
  for (const result of suite.tests) {
    if (signal.aborted) break;
    onProgress?.({ type: 'test-done', result });
  }
}

function notifyCancelled(
  onProgress: ((event: BenchmarkProgressEvent) => void) | undefined,
): void {
  onProgress?.({ type: 'run-cancelled' });
}

export async function runBenchmark(options: RunBenchmarkOptions = {}): Promise<BenchmarkRun> {
  const preset = options.preset ?? 'quick';
  const suites = suitesForPreset(preset, options.suites);
  const signal = options.signal ?? new AbortController().signal;
  const onProgress = options.onProgress;

  const binding = await resolveBenchmarkBinding();
  const localServer = await detectLocalServer();
  const ctx: BenchmarkRunContext = {
    providerId: binding.providerId,
    modelId: binding.modelId,
    localServer,
    signal,
  };

  const startedAt = new Date().toISOString();
  const runT0 = performance.now();
  const suiteResults: SuiteResult[] = [];
  let headlineTtftMs = 0;
  let headlineTokPerSec = 0;

  try {
    for (const suiteId of suites) {
      assertNotAborted(signal);

      onProgress?.({ type: 'suite-start', suiteId, label: suiteLabel(suiteId) });

      if (suiteId === 'capability') {
        const suite = await runCapabilitySuite(ctx);
        suiteResults.push(suite);
        emitTestResults(suite, onProgress, signal);
        if (signal.aborted) break;
        continue;
      }

      if (suiteId === 'speed') {
        const { suite, headlineTtftMs: ttft, headlineTokPerSec: tps } = await runSpeedSuite(ctx);
        headlineTtftMs = ttft;
        headlineTokPerSec = tps;
        suiteResults.push(suite);
        emitTestResults(suite, onProgress, signal);
        if (signal.aborted) break;
        continue;
      }

      if (suiteId === 'tools') {
        const suite = await runToolsSuite(ctx);
        suiteResults.push(suite);
        emitTestResults(suite, onProgress, signal);
        if (signal.aborted) break;
        continue;
      }

      if (suiteId === 'skills') {
        const suite = await runSkillsSuite(ctx);
        suiteResults.push(suite);
        emitTestResults(suite, onProgress, signal);
        if (signal.aborted) break;
        continue;
      }

      if (suiteId === 'modes') {
        const suite = await runModesSuite(ctx);
        suiteResults.push(suite);
        emitTestResults(suite, onProgress, signal);
        if (signal.aborted) break;
        continue;
      }

      if (suiteId === 'coding') {
        const suite = await runCodingSuite(ctx);
        suiteResults.push(suite);
        emitTestResults(suite, onProgress, signal);
        if (signal.aborted) break;
      }
    }

    if (signal.aborted) {
      throw benchmarkAbortError(signal);
    }

    const toolsSuite = suiteResults.find((s) => s.id === 'tools');
    const skillsSuite = suiteResults.find((s) => s.id === 'skills');
    const modesSuite = suiteResults.find((s) => s.id === 'modes');

    const run: BenchmarkRun = {
      id: newRunId(),
      startedAt,
      durationMs: Math.round(performance.now() - runT0),
      preset,
      provider: { id: binding.provider.id, baseUrl: binding.provider.baseUrl },
      model: { id: binding.modelId },
      totalScore: aggregateRunScore(suiteResults),
      headlineTtftMs,
      headlineTokPerSec,
      modeMatrixPassed: modesSuite?.passed ?? 0,
      toolsPassed: toolsSuite?.passed ?? 0,
      skillsPassed: skillsSuite?.passed ?? 0,
      suites: suiteResults,
    };

    await saveRun(run);
    onProgress?.({ type: 'run-done', run });
    return run;
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      notifyCancelled(onProgress);
      if (isAbortError(err)) throw err;
      throw benchmarkAbortError(signal);
    }
    throw err;
  }
}
