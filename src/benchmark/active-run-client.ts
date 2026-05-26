/**
 * Client for server-side active benchmark runs (survives page reload).
 */

import { detectLocalServer } from '../tools/client';
import type { BenchmarkPreset, BenchmarkProgressEvent, BenchmarkRun, SuiteId } from './types.ts';
import type { ProviderPublic } from '../providers/types.ts';

export type ActiveBenchmarkStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';

export interface ActiveBenchmarkConfig {
  baseUrl: string;
  preset: BenchmarkPreset;
  suites: SuiteId[];
  providerId: string;
  modelId: string;
  provider: ProviderPublic;
  startedAt: string;
}

export interface ActiveBenchmarkSnapshot {
  status: ActiveBenchmarkStatus;
  events: BenchmarkProgressEvent[];
  config: ActiveBenchmarkConfig | null;
  run: BenchmarkRun | null;
  error: string | null;
}

export interface StartActiveBenchmarkParams {
  baseUrl: string;
  preset: BenchmarkPreset;
  suites: SuiteId[];
  providerId: string;
  modelId: string;
  provider: ProviderPublic;
}

/** Whether the dev server exposes the active-run API. */
export async function isActiveBenchmarkApiAvailable(): Promise<boolean> {
  return detectLocalServer();
}

/** Read current server-side benchmark session (poll while running). */
export async function fetchActiveBenchmarkSnapshot(): Promise<ActiveBenchmarkSnapshot | null> {
  if (!(await detectLocalServer())) return null;
  try {
    const res = await fetch('/api/benchmarks/active', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ActiveBenchmarkSnapshot;
  } catch {
    return null;
  }
}

/** Start a benchmark in a server child process. */
export async function startActiveBenchmarkOnServer(
  params: StartActiveBenchmarkParams,
): Promise<ActiveBenchmarkSnapshot | null> {
  if (!(await detectLocalServer())) return null;
  const body = {
    ...params,
    startedAt: new Date().toISOString(),
  };
  const res = await fetch('/api/benchmarks/active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as ActiveBenchmarkSnapshot;
}

/** Abort the server-side benchmark child process. */
export async function abortActiveBenchmarkOnServer(): Promise<void> {
  if (!(await detectLocalServer())) return;
  try {
    await fetch('/api/benchmarks/active', { method: 'DELETE' });
  } catch {
    /* ignore */
  }
}
