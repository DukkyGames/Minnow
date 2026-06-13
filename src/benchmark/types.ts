/**
 * Bench run types: deterministic battery against the active model.
 */

import type { ApiMessage, Stats, Usage } from '../types.ts';
import type { BenchmarkBinding } from './resolve-binding.ts';

/** Suite identifiers for the benchmark runner. */
export type SuiteId =
  | 'capability'
  | 'speed'
  | 'tools'
  | 'skills'
  | 'coding';

/** quick/full = preset runs; custom = user-selected suite subset via Run. */
export type BenchmarkPreset = 'quick' | 'full' | 'custom';

/** How a single test case is scored. */
export type ScoringKind =
  | 'exact'
  | 'regex'
  | 'json_shape'
  | 'tool_name'
  | 'tool_args'
  | 'judge'
  | 'timing_only'
  | 'custom';

export interface TestCase {
  id: string;
  suite: SuiteId;
  label: string;
  scoring: ScoringKind;
  /** Optional skip when predicate returns a reason string. */
  skipWhen?: (ctx: BenchmarkRunContext) => string | null;
}

export interface BenchmarkRunContext {
  providerId: string;
  modelId: string;
  localServer: boolean;
  signal: AbortSignal;
  /**
   * Set by `runBenchmark` to forward each starting probe to `onProgress` as `{ type: 'test-start' }`.
   * Suites should call `announceTestStart` immediately before async work on a probe.
   */
  onTestStart?: (meta: Pick<TestResult, 'testId' | 'suite' | 'label'>) => void;
  /**
   * Set by `runBenchmark` to forward each finished probe to `onProgress` as `{ type: 'test-done' }`.
   * Suites should call `reportTest` (or invoke this after each result) so the UI updates per test.
   */
  onTestDone?: (result: TestResult) => void;
}

export interface TestResult {
  testId: string;
  suite: SuiteId;
  label: string;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  judged?: boolean;
  durationMs: number;
  ttftMs?: number;
  tokPerSec?: number;
  score: number;
  details?: string;
  /** Optional full conversation for this probe (API message shape). */
  transcript?: ApiMessage[];
  /** Structured extras for debugging (not shown in main chat). */
  transcriptMeta?: {
    finishReason?: string;
    error?: string;
    /** Judge model output for coding suite, etc. */
    judgeRaw?: string;
  };
}

export interface SuiteResult {
  id: SuiteId;
  label: string;
  passed: number;
  failed: number;
  skipped: number;
  score: number;
  tests: TestResult[];
}

export interface ScoreBreakdown {
  totalScore: number;
  headlineTtftMs: number;
  headlineTokPerSec: number;
  modeMatrixPassed: number;
  toolsPassed: number;
  skillsPassed: number;
}

export interface BenchmarkRun {
  id: string;
  startedAt: string;
  durationMs: number;
  preset: BenchmarkPreset;
  provider: { id: string; baseUrl: string };
  model: { id: string; contextLength?: number };
  totalScore: number;
  headlineTokPerSec: number;
  headlineTtftMs: number;
  modeMatrixPassed: number;
  toolsPassed: number;
  skillsPassed: number;
  suites: SuiteResult[];
}

export interface LlmTurnTiming {
  ttftMs: number | null;
  totalMs: number;
  tokPerSec: number | null;
  usage: Usage;
  stats: Stats;
  finishReason?: string;
}

export type BenchmarkProgressEvent =
  | { type: 'suite-start'; suiteId: SuiteId; label: string }
  | { type: 'test-start'; suiteId: SuiteId; testId: string; label: string }
  | { type: 'test-done'; result: TestResult }
  | { type: 'target-start'; targetKey: string }
  | { type: 'target-done'; targetKey: string }
  | { type: 'metric-sample'; targetKey: string; tokPerSec?: number; ttftMs?: number }
  | { type: 'run-cancelled' }
  | { type: 'run-done'; run: BenchmarkRun };

/** Prior work to merge when resuming after a page reload (suite-level skip). */
export interface BenchmarkResumeState {
  runId: string;
  startedAt: string;
  priorSuites: SuiteResult[];
}

export interface RunBenchmarkOptions {
  suites?: SuiteId[];
  preset?: BenchmarkPreset;
  signal?: AbortSignal;
  onProgress?: (event: BenchmarkProgressEvent) => void;
  /** Reuse run id / startedAt and skip suites already in `priorSuites`. */
  resume?: BenchmarkResumeState;
  /** Override generated run id (must match session when resuming). */
  runId?: string;
  /** Explicit provider/model (multi-model campaigns). */
  binding?: BenchmarkBinding;
  /** When false, caller persists (campaign save). Default true. */
  saveToHistory?: boolean;
  /** Per-test timeout for tools suite (BUG-006 mitigation). */
  perTestTimeoutMs?: number;
}
