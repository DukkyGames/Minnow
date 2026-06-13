/**
 * Multi-model benchmark campaign types (unified bench + eval surface).
 */

import type { ApiMessage } from '../types.ts';
import type { EvalCellResult } from '../evals/types.ts';
import type { BenchmarkPreset, BenchmarkRun, SuiteId, TestResult } from './types.ts';

/** High-level suite families in the unified benchmark app. */
export type SuiteFamily = 'integration' | 'standard' | 'custom';

/** Dataset tier for standard LLM benchmarks. */
export type BenchmarkTier = 'mini' | 'full';

export interface BenchmarkTarget {
  providerId: string;
  modelId: string;
  label?: string;
}

export interface SelectedSuite {
  family: SuiteFamily;
  /** Integration suite id, standard pack id, or custom eval pack id. */
  id: string;
  tier?: BenchmarkTier;
}

export type CampaignStatus = 'running' | 'completed' | 'cancelled';

/** Per-target rollup shown on Overview and Charts. */
export interface ModelAggregate {
  targetKey: string;
  providerId: string;
  modelId: string;
  label: string;
  totalScore: number;
  headlineTokPerSec: number;
  headlineTtftMs: number;
  integrationScore: number;
  standardScore: number;
  customScore: number;
  runId?: string;
}

/** One scored cell in a campaign matrix (target × work item). */
export interface BenchmarkCellResult {
  cellId: string;
  targetKey: string;
  family: SuiteFamily;
  suiteId: string;
  testId: string;
  label: string;
  passed: boolean;
  skipped: boolean;
  score: number;
  durationMs: number;
  ttftMs?: number;
  tokPerSec?: number;
  details?: string;
  /** Full one-shot conversation for Academic probes (same shape as integration transcripts). */
  transcript?: ApiMessage[];
  transcriptMeta?: TestResult['transcriptMeta'];
  integrationResult?: TestResult;
  evalResult?: EvalCellResult;
}

export interface BenchmarkCampaign {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  preset: BenchmarkPreset;
  targets: BenchmarkTarget[];
  suites: SelectedSuite[];
  status: CampaignStatus;
  cells: BenchmarkCellResult[];
  aggregates: ModelAggregate[];
  /** Legacy single-target runs embedded for drill-down. */
  runs: BenchmarkRun[];
}

export interface BenchmarkCampaignSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: CampaignStatus;
  targetCount: number;
  preset: BenchmarkPreset;
  topScore: number;
}

export interface ModelScoreIndexRow {
  targetKey: string;
  providerId: string;
  modelId: string;
  label: string;
  campaignId: string;
  startedAt: string;
  totalScore: number;
  headlineTokPerSec: number;
  headlineTtftMs: number;
}

export interface RunCampaignOptions {
  targets: BenchmarkTarget[];
  integrationSuites?: SuiteId[];
  standardPackIds?: string[];
  standardTier?: BenchmarkTier;
  customPackIds?: string[];
  preset?: BenchmarkPreset;
  signal?: AbortSignal;
  maxConcurrency?: number;
  persistPartialOnCancel?: boolean;
  onProgress?: (event: CampaignProgressEvent) => void;
}

export type CampaignProgressEvent =
  | { type: 'campaign-start'; campaignId: string; targetCount: number }
  | { type: 'phase'; phase: CampaignPhase; label: string }
  | { type: 'target-start'; targetKey: string; label: string }
  | { type: 'target-done'; targetKey: string; aggregate: ModelAggregate }
  | { type: 'metric-sample'; targetKey: string; tokPerSec?: number; ttftMs?: number }
  | { type: 'integration-progress'; targetKey: string; event: import('./types.ts').BenchmarkProgressEvent }
  | { type: 'cell-done'; cell: BenchmarkCellResult }
  | { type: 'campaign-cancelled'; campaign: BenchmarkCampaign }
  | { type: 'campaign-done'; campaign: BenchmarkCampaign };

export type CampaignPhase =
  | 'planning'
  | 'warming'
  | 'running'
  | 'aggregating'
  | 'done';

export const ROSTER_STORAGE_KEY = 'minnow.benchmark.roster';

export const BENCHMARK_TAB_IDS = ['overview', 'charts', 'tests', 'run'] as const;
export type BenchmarkTabId = (typeof BENCHMARK_TAB_IDS)[number];
