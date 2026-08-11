/**
 * Durable capability matrix roster (server + localStorage; survives restarts).
 */

import { detectLocalServer } from '../../tools/client.ts';
import type { BenchmarkTarget } from '../campaign-types.ts';
import { classifyProviderHost } from './host-group.ts';
import type { CapabilityHostBand } from './host-group.ts';

const LOCAL_ROSTER_KEY = 'minnow.capability-matrix.roster';

export interface CapabilityMatrixRosterEntry extends BenchmarkTarget {
  enabled?: boolean;
}

export interface CapabilityMatrixRoster {
  targets: CapabilityMatrixRosterEntry[];
  updatedAt?: string;
}

function readLocalRoster(): CapabilityMatrixRoster {
  try {
    const raw = localStorage.getItem(LOCAL_ROSTER_KEY);
    if (!raw) return { targets: [] };
    const parsed = JSON.parse(raw) as CapabilityMatrixRoster;
    if (!parsed || !Array.isArray(parsed.targets)) return { targets: [] };
    return parsed;
  } catch {
    return { targets: [] };
  }
}

function writeLocalRoster(roster: CapabilityMatrixRoster): void {
  localStorage.setItem(LOCAL_ROSTER_KEY, JSON.stringify(roster));
}

/** Host band for roster grouping (Cloud / LM Studio / Minnow Hosting). */
export function rosterEntryHostBand(entry: BenchmarkTarget): CapabilityHostBand {
  return classifyProviderHost(entry.providerId);
}

/** Load roster from server with localStorage fallback. */
export async function loadCapabilityMatrixRoster(): Promise<CapabilityMatrixRoster> {
  const local = readLocalRoster();
  const serverUp = await detectLocalServer();
  if (!serverUp) return local;
  try {
    const res = await fetch('/api/benchmarks/capability-matrix/roster', {
      cache: 'no-store',
    });
    if (!res.ok) return local;
    const data = (await res.json()) as CapabilityMatrixRoster;
    if (!data || !Array.isArray(data.targets)) return local;
    writeLocalRoster(data);
    return data;
  } catch {
    return local;
  }
}

/** Persist full roster (PUT). */
export async function saveCapabilityMatrixRoster(
  targets: CapabilityMatrixRosterEntry[],
): Promise<void> {
  const roster: CapabilityMatrixRoster = {
    targets,
    updatedAt: new Date().toISOString(),
  };
  const serverUp = await detectLocalServer();
  if (serverUp) {
    const res = await fetch('/api/benchmarks/capability-matrix/roster', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roster),
    });
    if (res.ok) {
      writeLocalRoster(roster);
      return;
    }
  }
  writeLocalRoster(roster);
}
