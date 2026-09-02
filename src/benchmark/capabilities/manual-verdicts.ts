/**
 * Manual capability matrix verdicts — client API (server + localStorage fallback).
 */

import { detectLocalServer } from '../../tools/client.ts';
import type { CapabilityVerdict } from './types.ts';

const LOCAL_VERDICTS_KEY = 'minnow.capability-matrix.verdicts';

export interface ManualCapabilityVerdict {
  targetKey: string;
  capabilityId: string;
  verdict: CapabilityVerdict;
  note?: string;
  updatedAt: string;
}

export type ManualVerdictStore = Record<string, ManualCapabilityVerdict>;

export function manualVerdictKey(targetKey: string, capabilityId: string): string {
  return `${targetKey}::${capabilityId}`;
}

function readLocalVerdicts(): ManualVerdictStore {
  try {
    const raw = localStorage.getItem(LOCAL_VERDICTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ManualVerdictStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalVerdicts(store: ManualVerdictStore): void {
  localStorage.setItem(LOCAL_VERDICTS_KEY, JSON.stringify(store));
}

/** Load all manual verdicts (newest server wins when both exist). */
export async function loadManualVerdicts(): Promise<ManualVerdictStore> {
  const local = readLocalVerdicts();
  const serverUp = await detectLocalServer();
  if (!serverUp) return local;
  try {
    const res = await fetch('/api/benchmarks/capability-matrix/verdicts', {
      cache: 'no-store',
    });
    if (!res.ok) return local;
    const data = (await res.json()) as { verdicts?: ManualVerdictStore };
    const server = data.verdicts && typeof data.verdicts === 'object' ? data.verdicts : {};
    return { ...local, ...server };
  } catch {
    return local;
  }
}

/** Upsert one manual cell (never written by auto runs). */
export async function upsertManualVerdict(
  verdict: ManualCapabilityVerdict,
): Promise<void> {
  const key = manualVerdictKey(verdict.targetKey, verdict.capabilityId);
  const serverUp = await detectLocalServer();
  if (serverUp) {
    const res = await fetch('/api/benchmarks/capability-matrix/verdicts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verdict),
    });
    if (res.ok) {
      const store = readLocalVerdicts();
      store[key] = verdict;
      writeLocalVerdicts(store);
      return;
    }
  }
  const store = readLocalVerdicts();
  store[key] = verdict;
  writeLocalVerdicts(store);
}

/** Bulk import (xlsx migration); replaces manual store on server when available. */
export async function importManualVerdicts(
  verdicts: ManualCapabilityVerdict[],
): Promise<void> {
  const serverUp = await detectLocalServer();
  if (serverUp) {
    const res = await fetch('/api/benchmarks/capability-matrix/import', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdicts }),
    });
    if (res.ok) {
      const store: ManualVerdictStore = {};
      for (const row of verdicts) {
        store[manualVerdictKey(row.targetKey, row.capabilityId)] = row;
      }
      writeLocalVerdicts(store);
      return;
    }
  }
  const store = readLocalVerdicts();
  for (const row of verdicts) {
    store[manualVerdictKey(row.targetKey, row.capabilityId)] = row;
  }
  writeLocalVerdicts(store);
}

/** Clear manual verdicts (Settings danger zone). */
export async function clearManualVerdicts(): Promise<void> {
  localStorage.removeItem(LOCAL_VERDICTS_KEY);
  const serverUp = await detectLocalServer();
  if (!serverUp) return;
  try {
    await fetch('/api/benchmarks/capability-matrix/import', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdicts: [] }),
    });
  } catch {}
}
