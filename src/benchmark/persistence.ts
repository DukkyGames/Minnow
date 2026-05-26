/**
 * Benchmark run history: server API primary, localStorage fallback.
 */

import { detectLocalServer } from '../tools/client';
import { prepareBenchmarkRunForPersistence } from './test-result.ts';
import type { BenchmarkRun } from './types.ts';

const LOCAL_KEY = 'minnow.benchmarks.history';
const LOCAL_CAP = 5;
const LIST_CAP = 20;

export interface BenchmarkRunSummary {
  id: string;
  startedAt: string;
  modelId: string;
  providerId: string;
  totalScore: number;
  headlineTtftMs: number;
  headlineTokPerSec: number;
}

function readLocalRuns(): BenchmarkRun[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BenchmarkRun[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalRuns(runs: BenchmarkRun[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(runs.slice(0, LOCAL_CAP)));
}

function summaryFromRun(run: BenchmarkRun): BenchmarkRunSummary {
  return {
    id: run.id,
    startedAt: run.startedAt,
    modelId: run.model.id,
    providerId: run.provider.id,
    totalScore: run.totalScore,
    headlineTtftMs: run.headlineTtftMs,
    headlineTokPerSec: run.headlineTokPerSec,
  };
}

/** Merge server and local summaries; server wins on duplicate ids, newest first. */
export function mergeBenchmarkRunSummaries(
  server: BenchmarkRunSummary[],
  local: BenchmarkRunSummary[],
): BenchmarkRunSummary[] {
  const byId = new Map<string, BenchmarkRunSummary>();
  for (const row of local) {
    if (row?.id) byId.set(row.id, row);
  }
  for (const row of server) {
    if (row?.id) byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, LIST_CAP);
}

/** Persist a completed run. */
export async function saveRun(run: BenchmarkRun): Promise<void> {
  const payload = prepareBenchmarkRunForPersistence(run);
  const local = await detectLocalServer();
  if (local) {
    const res = await fetch('/api/benchmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return;
    if (res.status === 413) {
      const stripped = prepareBenchmarkRunForPersistence(run);
      const retry = await fetch('/api/benchmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stripped),
      });
      if (retry.ok) return;
    }
  }
  const existing = readLocalRuns();
  writeLocalRuns([payload, ...existing.filter((r) => r.id !== run.id)]);
}

/** List recent runs (summaries). */
export async function listRuns(): Promise<BenchmarkRunSummary[]> {
  const localSummaries = readLocalRuns().map(summaryFromRun);
  const serverUp = await detectLocalServer();
  if (serverUp) {
    try {
      const res = await fetch('/api/benchmarks', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { runs?: BenchmarkRunSummary[] };
        const serverRuns = Array.isArray(data.runs) ? data.runs : [];
        return mergeBenchmarkRunSummaries(serverRuns, localSummaries);
      }
    } catch {
      /* fall through */
    }
  }
  return localSummaries;
}

/** Load full run JSON by id. */
export async function loadRun(id: string): Promise<BenchmarkRun | null> {
  const local = await detectLocalServer();
  if (local) {
    try {
      const res = await fetch(`/api/benchmarks/${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        return (await res.json()) as BenchmarkRun;
      }
    } catch {
      /* fall through */
    }
  }
  return readLocalRuns().find((r) => r.id === id) ?? null;
}
