/**
 * Workspace issue-label catalog: one color per name, shared across every issue.
 *
 * Colors are a fixed 10-swatch set (Linear-style tints), not the metric
 * success / warning / danger tokens. GitHub sync still sends names only.
 */

import type { IssueLabelCatalogEntry, IssueLabelSwatchId } from '../types';

/** Trim and collapse whitespace for a single issue label. */
export function normalizeIssueLabel(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

/** Palette order used for first-unused assignment. */
export const ISSUE_LABEL_SWATCH_IDS = [
  'clay',
  'apricot',
  'pollen',
  'moss',
  'kelp',
  'tide',
  'dusk',
  'fig',
  'blush',
  'pebble',
] as const satisfies readonly IssueLabelSwatchId[];

/** Visible cap in list and board rows. Peek shows the full set. */
export const ISSUE_LABEL_LIST_LIMIT = 3;

/** Screen-reader names for the swatch picker. */
export const ISSUE_LABEL_SWATCH_LABELS: Record<IssueLabelSwatchId, string> = {
  clay: 'Clay',
  apricot: 'Apricot',
  pollen: 'Pollen',
  moss: 'Moss',
  kelp: 'Kelp',
  tide: 'Tide',
  dusk: 'Dusk',
  fig: 'Fig',
  blush: 'Blush',
  pebble: 'Pebble',
};

const SWATCH_SET = new Set<string>(ISSUE_LABEL_SWATCH_IDS);

/** True when `raw` is a known swatch id. */
export function isIssueLabelSwatchId(raw: string): raw is IssueLabelSwatchId {
  return SWATCH_SET.has(raw);
}

/** CSS custom property for a swatch (`--mn-label-clay`). */
export function issueLabelSwatchToken(color: IssueLabelSwatchId): string {
  return `var(--mn-label-${color})`;
}

/**
 * Next swatch for a new catalog name: first unused, then the least-used
 * (ties break in palette order) so the 11th label is still distinct-ish.
 */
export function pickNextLabelSwatch(used: readonly IssueLabelSwatchId[]): IssueLabelSwatchId {
  const counts = new Map<IssueLabelSwatchId, number>();
  for (const id of ISSUE_LABEL_SWATCH_IDS) counts.set(id, 0);
  for (const id of used) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: IssueLabelSwatchId = ISSUE_LABEL_SWATCH_IDS[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const id of ISSUE_LABEL_SWATCH_IDS) {
    const count = counts.get(id) ?? 0;
    if (count < bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/** Parse a persisted catalog; drop empty names and unknown colors. */
export function parseIssueLabelCatalog(raw: unknown): IssueLabelCatalogEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: IssueLabelCatalogEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { name?: unknown; color?: unknown };
    const name = typeof row.name === 'string' ? normalizeIssueLabel(row.name) : null;
    const color = typeof row.color === 'string' ? row.color.trim() : '';
    if (!name || !isIssueLabelSwatchId(color)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, color });
  }
  return out;
}

/** Deduplicate labels case-insensitively while preserving first-seen casing. */
export function normalizeIssueLabelsList(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = normalizeIssueLabel(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** Unique names from issue cards, first-seen casing, sorted for stable migration. */
export function uniqueIssueLabelNames(labelLists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const byKey = new Map<string, string>();
  for (const list of labelLists) {
    for (const raw of list) {
      const name = normalizeIssueLabel(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      byKey.set(key, name);
    }
  }
  return [...byKey.keys()].sort((a, b) => a.localeCompare(b)).map((key) => byKey.get(key) as string);
}

/**
 * Keep existing catalog colors; assign first-unused swatches to names the
 * catalog has not seen yet. Does not recolor names that already have an entry.
 */
export function mergeIssueLabelCatalog(
  catalog: readonly IssueLabelCatalogEntry[],
  names: readonly string[],
): { catalog: IssueLabelCatalogEntry[]; changed: boolean } {
  const byKey = new Map<string, IssueLabelCatalogEntry>();
  for (const entry of catalog) {
    const name = normalizeIssueLabel(entry.name);
    if (!name || !isIssueLabelSwatchId(entry.color)) continue;
    const key = name.toLowerCase();
    if (byKey.has(key)) continue;
    byKey.set(key, { name, color: entry.color });
  }

  let changed = byKey.size !== catalog.length;
  const used = [...byKey.values()].map((entry) => entry.color);
  const missing = uniqueIssueLabelNames([names]).filter((name) => !byKey.has(name.toLowerCase()));
  for (const name of missing) {
    const color = pickNextLabelSwatch(used);
    used.push(color);
    byKey.set(name.toLowerCase(), { name, color });
    changed = true;
  }

  return { catalog: [...byKey.values()], changed };
}

/** Split a list into the chips that stay on the row and the overflow set. */
export function splitIssueLabelsForList(
  labels: readonly string[],
  limit = ISSUE_LABEL_LIST_LIMIT,
): { visible: string[]; hidden: string[]; hiddenCount: number } {
  const visible = labels.slice(0, limit);
  const hidden = labels.slice(limit);
  return { visible, hidden, hiddenCount: hidden.length };
}
