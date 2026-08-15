/**
 * Campaign persistence: server API + localStorage fallback.
 */

import { detectLocalServer } from '../tools/client.ts';
import { buildModelScoreIndex } from './aggregates.ts';
import type {
  BenchmarkCampaign,
  BenchmarkCampaignSummary,
  ModelScoreIndexRow,
} from './campaign-types.ts';
import { prepareCampaignForPersistence } from './campaign-persist-prep.ts';
import { registerImportedStandardPack } from './standard/pack-loader.ts';
import type { StandardBenchmarkPack } from './standard/types.ts';

const LOCAL_CAMPAIGNS_KEY = 'minnow.benchmarks.campaigns';
const LOCAL_CAP = 10;

function readLocalCampaigns(): BenchmarkCampaign[] {
  try {
    const raw = localStorage.getItem(LOCAL_CAMPAIGNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BenchmarkCampaign[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCampaigns(campaigns: BenchmarkCampaign[]): void {
  localStorage.setItem(
    LOCAL_CAMPAIGNS_KEY,
    JSON.stringify(campaigns.slice(0, LOCAL_CAP)),
  );
}

function summaryFromCampaign(c: BenchmarkCampaign): BenchmarkCampaignSummary {
  const topScore = c.aggregates.length
    ? Math.max(...c.aggregates.map((a) => a.totalScore))
    : 0;
  return {
    id: c.id,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    status: c.status,
    targetCount: c.targets.length,
    preset: c.preset,
    topScore,
    kind: c.kind,
  };
}

/** Persist a completed or partial campaign. */
export async function saveCampaign(campaign: BenchmarkCampaign): Promise<void> {
  const payload = prepareCampaignForPersistence(campaign);
  const local = await detectLocalServer();
  if (local) {
    const res = await fetch('/api/benchmarks/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return;
    if (res.status === 413) {
      const stripped = prepareCampaignForPersistence(campaign, {
        stripAllTranscripts: true,
      });
      const retry = await fetch('/api/benchmarks/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stripped),
      });
      if (retry.ok) return;
    }
  }
  const existing = readLocalCampaigns();
  writeLocalCampaigns([payload, ...existing.filter((c) => c.id !== campaign.id)]);
}

/** List campaign summaries (newest first). */
export async function listCampaignSummaries(): Promise<BenchmarkCampaignSummary[]> {
  const localSummaries = readLocalCampaigns().map(summaryFromCampaign);
  const serverUp = await detectLocalServer();
  if (serverUp) {
    try {
      const res = await fetch('/api/benchmarks/campaigns', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { campaigns?: BenchmarkCampaignSummary[] };
        const server = Array.isArray(data.campaigns) ? data.campaigns : [];
        const byId = new Map<string, BenchmarkCampaignSummary>();
        for (const row of localSummaries) byId.set(row.id, row);
        for (const row of server) byId.set(row.id, row);
        return [...byId.values()].sort((a, b) =>
          String(b.startedAt).localeCompare(String(a.startedAt)),
        );
      }
    } catch {
      /* fall through */
    }
  }
  return localSummaries;
}

/** Load full campaign by id. */
export async function loadCampaign(id: string): Promise<BenchmarkCampaign | null> {
  const serverUp = await detectLocalServer();
  if (serverUp) {
    try {
      const res = await fetch(
        `/api/benchmarks/campaigns/${encodeURIComponent(id)}`,
        { cache: 'no-store' },
      );
      if (res.ok) return (await res.json()) as BenchmarkCampaign;
    } catch {
      /* fall through */
    }
  }
  return readLocalCampaigns().find((c) => c.id === id) ?? null;
}

/** Latest score per model for Overview. */
export async function fetchModelScoreIndex(): Promise<ModelScoreIndexRow[]> {
  const serverUp = await detectLocalServer();
  if (serverUp) {
    try {
      const res = await fetch('/api/benchmarks/models', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { models?: ModelScoreIndexRow[] };
        if (Array.isArray(data.models) && data.models.length) return data.models;
      }
    } catch {
      /* fall through */
    }
  }
  return buildModelScoreIndex(readLocalCampaigns());
}

/** Import a full-tier standard dataset pack. */
export async function importStandardDataset(
  pack: StandardBenchmarkPack,
): Promise<void> {
  const serverUp = await detectLocalServer();
  if (serverUp) {
    const res = await fetch('/api/benchmarks/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pack),
    });
    if (res.ok) {
      registerImportedStandardPack(pack);
      return;
    }
  }
  registerImportedStandardPack(pack);
}

/** Load user-imported full-tier packs from the tool server into memory. */
export async function loadImportedStandardDatasets(): Promise<number> {
  const serverUp = await detectLocalServer();
  if (!serverUp) return 0;
  try {
    const res = await fetch('/api/benchmarks/datasets', { cache: 'no-store' });
    if (!res.ok) return 0;
    const data = (await res.json()) as { datasets?: StandardBenchmarkPack[] };
    const datasets = Array.isArray(data.datasets) ? data.datasets : [];
    for (const pack of datasets) {
      if (pack?.id && Array.isArray(pack.items)) {
        registerImportedStandardPack(pack);
      }
    }
    return datasets.length;
  } catch {
    return 0;
  }
}
