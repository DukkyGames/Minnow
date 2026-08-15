/**
 * Capability matrix grid view-model (pure; Settings UI + tests).
 */

import type { BenchmarkCampaign } from '../campaign-types.ts';
import { targetKeyFromTarget, targetLabel } from '../model-key.ts';
import { CAPABILITY_CATALOG } from './catalog.ts';
import {
  CAPABILITY_GROUP_LABELS,
  CAPABILITY_GROUP_ORDER,
} from './groups.ts';
import {
  CAPABILITY_HOST_BAND_LABELS,
  type CapabilityHostBand,
} from './host-group.ts';
import {
  mergeCapabilityMatrix,
  type AutoCapabilityVerdict,
  type MergedCapabilityCell,
} from './merge.ts';
import type { ManualVerdictStore } from './manual-verdicts.ts';
import type { CapabilityMatrixRosterEntry } from './roster-store.ts';
import { rosterEntryHostBand } from './roster-store.ts';
import { capabilityRowScore } from './score.ts';
import type { CapabilityGroupId, CapabilityVerdict } from './types.ts';

/** Spreadsheet-style cell glyphs (visible in grid + screen readers via title). */
export const CAPABILITY_VERDICT_GLYPH: Record<CapabilityVerdict, string> = {
  pass: '✓',
  partial: '◐',
  fail: '✗',
  'n-a': '—',
  untested: '·',
};

export function capabilityVerdictGlyph(verdict: CapabilityVerdict): string {
  return CAPABILITY_VERDICT_GLYPH[verdict] ?? '·';
}

export interface CapabilityMatrixRosterRow extends CapabilityMatrixRosterEntry {
  targetKey: string;
}

export interface CapabilityMatrixRosterGroup {
  host: CapabilityHostBand;
  label: string;
  entries: CapabilityMatrixRosterRow[];
}

export interface CapabilityMatrixRowView {
  capabilityId: string;
  header: string;
  groupId: CapabilityGroupId;
  scoreMode: 'auto' | 'manual';
  cells: MergedCapabilityCell[];
}

export interface CapabilityMatrixGroupBand {
  id: CapabilityGroupId;
  label: string;
  rowCount: number;
}

export interface CapabilityMatrixViewModel {
  rosterGroups: CapabilityMatrixRosterGroup[];
  targetKeys: string[];
  targetLabels: Record<string, string>;
  rows: CapabilityMatrixRowView[];
  groupBands: CapabilityMatrixGroupBand[];
  cellByKey: Map<string, MergedCapabilityCell>;
  columnScores: Record<string, number | null>;
}

const HOST_BAND_ORDER: CapabilityHostBand[] = ['cloud', 'lm-studio', 'minnow-hosting'];

/** Group roster targets by Cloud / LM Studio / Minnow Hosting bands. */
export function groupRosterByHost(
  targets: CapabilityMatrixRosterEntry[],
): CapabilityMatrixRosterGroup[] {
  const byHost = new Map<CapabilityHostBand, CapabilityMatrixRosterRow[]>();
  for (const band of HOST_BAND_ORDER) byHost.set(band, []);

  for (const entry of targets) {
    if (entry.enabled === false) continue;
    const host = rosterEntryHostBand(entry);
    const list = byHost.get(host) ?? [];
    list.push({ ...entry, targetKey: targetKeyFromTarget(entry) });
    byHost.set(host, list);
  }

  return HOST_BAND_ORDER.map((host) => ({
    host,
    label: CAPABILITY_HOST_BAND_LABELS[host],
    entries: byHost.get(host) ?? [],
  })).filter((group) => group.entries.length > 0);
}

function cellMapKey(targetKey: string, capabilityId: string): string {
  return `${targetKey}::${capabilityId}`;
}

/** Merge roster, manual verdicts, and campaign runs into a grid view-model. */
export function buildCapabilityMatrixViewModel(input: {
  roster: CapabilityMatrixRosterEntry[];
  manualStore: ManualVerdictStore;
  campaigns: BenchmarkCampaign[];
  /** Auto verdicts from probes still in flight (before campaign save). */
  inFlightAutos?: AutoCapabilityVerdict[];
}): CapabilityMatrixViewModel {
  const enabled = input.roster.filter((t) => t.enabled !== false);
  const targetKeys = enabled.map((t) => targetKeyFromTarget(t));
  const capabilityIds = CAPABILITY_CATALOG.map((c) => c.id);

  const merged = mergeCapabilityMatrix({
    targetKeys,
    capabilityIds,
    manualStore: input.manualStore,
    campaigns: input.campaigns,
    extraAutos: input.inFlightAutos,
  });

  const cellByKey = new Map<string, MergedCapabilityCell>();
  for (const cell of merged) {
    cellByKey.set(cellMapKey(cell.targetKey, cell.capabilityId), cell);
  }

  const targetLabels: Record<string, string> = {};
  for (const target of enabled) {
    const key = targetKeyFromTarget(target);
    targetLabels[key] = targetLabel(target);
  }

  const columnScores: Record<string, number | null> = {};
  for (const key of targetKeys) {
    const verdicts = capabilityIds.map(
      (id) => cellByKey.get(cellMapKey(key, id))?.verdict ?? 'untested',
    );
    columnScores[key] = capabilityRowScore(verdicts);
  }

  const rows: CapabilityMatrixRowView[] = CAPABILITY_CATALOG.map((cap) => ({
    capabilityId: cap.id,
    header: cap.header,
    groupId: cap.group,
    scoreMode: cap.scoreMode,
    cells: targetKeys.map(
      (tk) =>
        cellByKey.get(cellMapKey(tk, cap.id)) ?? {
          targetKey: tk,
          capabilityId: cap.id,
          verdict: 'untested',
          source: 'none',
        },
    ),
  }));

  const groupBands = CAPABILITY_GROUP_ORDER.map((id) => ({
    id,
    label: CAPABILITY_GROUP_LABELS[id],
    rowCount: rows.filter((row) => row.groupId === id).length,
  })).filter((band) => band.rowCount > 0);

  return {
    rosterGroups: groupRosterByHost(input.roster),
    targetKeys,
    targetLabels,
    rows,
    groupBands,
    cellByKey,
    columnScores,
  };
}
