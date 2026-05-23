/**
 * Bench run types: deterministic battery against the active model.
 */

import type { Stats, Usage } from '../types';

/** Suite identifiers for the benchmark runner. */
export type SuiteId =
  | 'capability'
  | 'speed'
  | 'tools'
  | 'skills'
  | 'modes'
  | 'coding';

export type BenchmarkPreset = 'quick' | 'full';

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
  | { type: 'test-done'; result: TestResult }
  | { type: 'run-done'; run: BenchmarkRun };

export interface RunBenchmarkOptions {
  suites?: SuiteId[];
  preset?: BenchmarkPreset;
  signal?: AbortSignal;
  onProgress?: (event: BenchmarkProgressEvent) => void;
}
