/**
 * Persist an in-flight benchmark to sessionStorage so a full page reload can resume.
 */

import type { BenchmarkPreset, SuiteId, SuiteResult, TestResult } from './types.ts';
import type { BenchmarkTarget } from './campaign-types.ts';

const SESSION_KEY = 'minnow.benchmark.activeRun';
const SESSION_VERSION = 1 as const;

/** How the benchmark run bar started the active session (for UI labels on resume). */
export type ActiveBenchmarkStartMode = 'quick' | 'full' | 'selected';

/** Tags in-flight work (Settings matrix vs legacy bench bar). */
export type ActiveBenchmarkCampaignKind = 'integration' | 'capability-matrix';

/** Snapshot for resuming a Settings capability-matrix sweep after reload. */
export interface ActiveCapabilityMatrixRunPayload {
  campaignId: string;
  targets: BenchmarkTarget[];
  completedTargetKeys: string[];
  allowSideEffects: boolean;
  skipScored: boolean;
  groupIds: string[] | null;
  probeWaves: string[] | null;
  manageModelLifecycle: boolean;
  /** `${targetKey}::${capabilityId}` probes finished before reload/cancel. */
  completedProbeKeys?: string[];
}

export interface ActiveBenchmarkSession {
  version: typeof SESSION_VERSION;
  runId: string;
  startedAt: string;
  preset: BenchmarkPreset;
  startMode: ActiveBenchmarkStartMode;
  /** When set, resume UI can filter capability-matrix sweeps. */
  campaignKind?: ActiveBenchmarkCampaignKind;
  /** Settings capability matrix multi-target resume payload. */
  capabilityMatrixRun?: ActiveCapabilityMatrixRunPayload;
  suiteIds: SuiteId[];
  modelId: string;
  /** Fully finished suites (used to skip work on resume). */
  completedSuites: SuiteResult[];
  /** All finished probes so far (restores cards after reload). */
  completedTests: TestResult[];
  status: 'running';
}

export function loadActiveBenchmarkSession(): ActiveBenchmarkSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveBenchmarkSession;
    if (parsed?.version !== SESSION_VERSION || parsed.status !== 'running') return null;
    if (!parsed.runId || !Array.isArray(parsed.suiteIds) || parsed.suiteIds.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveActiveBenchmarkSession(session: ActiveBenchmarkSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
}

export function clearActiveBenchmarkSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

/** Suites not yet fully present in `completedSuites`. */
export function remainingSuiteIds(session: ActiveBenchmarkSession): SuiteId[] {
  const done = new Set(session.completedSuites.map((s) => s.id));
  return session.suiteIds.filter((id) => !done.has(id));
}
