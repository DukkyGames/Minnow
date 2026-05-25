/**
 * REST client for /api/evals/* persistence.
 */

import type {
  EvalCellResult,
  EvalConfig,
  EvalPack,
  EvalPackListItem,
  EvalSuiteRun,
  LeaderboardRow,
} from './types';
import { normalizeEvalConfig } from './config';

export async function pingEvalsApi(): Promise<boolean> {
  try {
    const res = await fetch('/api/evals/ping');
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchEvalPacksList(): Promise<EvalPackListItem[]> {
  const res = await fetch('/api/evals/packs');
  if (!res.ok) throw new Error('Failed to list eval packs');
  const data = (await res.json()) as { packs?: EvalPackListItem[] };
  return data.packs ?? [];
}

export async function fetchEvalPack(id: string): Promise<EvalPack> {
  const res = await fetch(`/api/evals/packs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Pack not found: ${id}`);
  const data = (await res.json()) as { pack: EvalPack };
  return data.pack;
}

export async function saveUserEvalPack(pack: EvalPack): Promise<void> {
  const res = await fetch(`/api/evals/packs/${encodeURIComponent(pack.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pack }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? 'Failed to save pack');
  }
}

export async function deleteUserEvalPack(id: string): Promise<void> {
  const res = await fetch(`/api/evals/packs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete pack');
}

export async function fetchEvalConfigApi(): Promise<EvalConfig> {
  const res = await fetch('/api/evals/config');
  if (!res.ok) return normalizeEvalConfig(null);
  return normalizeEvalConfig(await res.json());
}

export async function putEvalConfigApi(config: EvalConfig): Promise<void> {
  const res = await fetch('/api/evals/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to save eval config');
}

export interface EvalRunSummary {
  suiteRunId: string;
  packId: string;
  packLabel: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  totalCells: number;
  completedCells: number;
}

export async function listEvalRuns(): Promise<EvalRunSummary[]> {
  const res = await fetch('/api/evals/runs');
  if (!res.ok) return [];
  const data = (await res.json()) as { runs?: EvalRunSummary[] };
  return data.runs ?? [];
}

export interface EvalRunDetail {
  manifest: EvalSuiteRun;
  leaderboard: LeaderboardRow[];
  cellIds: string[];
}

export async function fetchEvalRun(suiteRunId: string): Promise<EvalRunDetail> {
  const res = await fetch(`/api/evals/runs/${encodeURIComponent(suiteRunId)}`);
  if (!res.ok) throw new Error('Run not found');
  return (await res.json()) as EvalRunDetail;
}

export async function saveEvalManifest(manifest: EvalSuiteRun): Promise<void> {
  const res = await fetch(`/api/evals/runs/${encodeURIComponent(manifest.suiteRunId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest }),
  });
  if (!res.ok) throw new Error('Failed to save manifest');
}

export async function saveEvalLeaderboard(
  suiteRunId: string,
  leaderboard: LeaderboardRow[],
): Promise<void> {
  const res = await fetch(
    `/api/evals/runs/${encodeURIComponent(suiteRunId)}/leaderboard`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leaderboard }),
    },
  );
  if (!res.ok) throw new Error('Failed to save leaderboard');
}

export async function saveEvalCell(
  suiteRunId: string,
  cell: EvalCellResult,
): Promise<void> {
  const res = await fetch(
    `/api/evals/runs/${encodeURIComponent(suiteRunId)}/cells/${encodeURIComponent(cell.cellId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cell }),
    },
  );
  if (!res.ok) throw new Error('Failed to save cell');
}

export async function fetchEvalCell(
  suiteRunId: string,
  cellId: string,
): Promise<EvalCellResult> {
  const res = await fetch(
    `/api/evals/runs/${encodeURIComponent(suiteRunId)}/cells/${encodeURIComponent(cellId)}`,
  );
  if (!res.ok) throw new Error('Cell not found');
  const data = (await res.json()) as { cell: EvalCellResult };
  return data.cell;
}
