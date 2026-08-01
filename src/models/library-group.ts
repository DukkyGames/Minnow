/**
 * Merge multiple GGUF quants of the same model (same repo + base name) into one
 * My Models row with a quant picker.
 */

import type { ServeRecord } from './api-client';
import { activeServeFor, type LibraryModel } from './library';
import {
  compareLibraryBySortKey,
  DEFAULT_LIBRARY_LIST_SORT,
  type LibraryListSort,
} from './library-sort';

/** Quant suffix stripped from a GGUF stem (matches server scan + catalog matching). */
export function stripQuantFromStem(stem: string): string {
  return stem.replace(
    /[-_.](?:UD-)?(?:IQ\d+_[A-Z0-9_]+|Q\d(?:_[A-Z0-9]+)+|BF16|F16|FP16|F32|Q8_0)$/i,
    '',
  );
}

/** Stable key for variants that share one logical model in the same HF repo. */
export function variantGroupKey(model: LibraryModel): string {
  const base = stripQuantFromStem(model.name);
  return `${model.repoId}:${base.toLowerCase()}`;
}

export interface LibraryVariantGroup {
  key: string;
  /** Base display name without quant tier. */
  displayName: string;
  /** Quant variants, sorted by quant label. */
  variants: LibraryModel[];
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/** Bucket loadable rows; single-quant models still become one-element groups. */
export function groupLibraryVariants(models: LibraryModel[]): LibraryVariantGroup[] {
  const byKey = new Map<string, LibraryModel[]>();
  for (const model of models) {
    const key = variantGroupKey(model);
    const bucket = byKey.get(key) ?? [];
    bucket.push(model);
    byKey.set(key, bucket);
  }

  const groups: LibraryVariantGroup[] = [];
  for (const [key, variants] of byKey) {
    variants.sort(
      (a, b) =>
        compareStrings(a.quant || a.format, b.quant || b.format) ||
        compareStrings(a.id, b.id),
    );
    const displayName = stripQuantFromStem(variants[0].name) || variants[0].name;
    groups.push({ key, displayName, variants });
  }
  return groups;
}

/**
 * Which variant drives row actions, size column, and inspector for a merged row.
 */
export function resolveActiveVariant(
  group: LibraryVariantGroup,
  selectedId: string | null,
  serves: ServeRecord[],
  preferredVariantId?: string | null,
): LibraryModel {
  if (selectedId) {
    const selected = group.variants.find((v) => v.id === selectedId);
    if (selected) return selected;
  }
  for (const variant of group.variants) {
    const serve = activeServeFor(variant, serves);
    if (serve?.status === 'running' || serve?.status === 'starting') return variant;
  }
  if (preferredVariantId) {
    const preferred = group.variants.find((v) => v.id === preferredVariantId);
    if (preferred) return preferred;
  }
  return group.variants[0];
}

function compareGroups(
  a: LibraryVariantGroup,
  b: LibraryVariantGroup,
  sort: LibraryListSort,
  selectedId: string | null,
  serves: ServeRecord[],
  preferences: ReadonlyMap<string, string>,
): number {
  const rowA = resolveActiveVariant(a, selectedId, serves, preferences.get(a.key));
  const rowB = resolveActiveVariant(b, selectedId, serves, preferences.get(b.key));
  const directionFactor = sort.direction === 'asc' ? 1 : -1;
  const primary = compareLibraryBySortKey(rowA, rowB, sort.key) * directionFactor;
  if (primary !== 0) return primary;
  return (
    compareStrings(a.displayName, b.displayName) ||
    compareStrings(rowA.quant, rowB.quant) ||
    compareStrings(rowA.id, rowB.id)
  );
}

/** Sort merged rows for the My Models table. */
export function sortLibraryGroups(
  groups: LibraryVariantGroup[],
  sort: LibraryListSort,
  selectedId: string | null,
  serves: ServeRecord[],
  preferences: ReadonlyMap<string, string> = new Map(),
): LibraryVariantGroup[] {
  return [...groups].sort((a, b) =>
    compareGroups(a, b, sort, selectedId, serves, preferences),
  );
}

/** Filter flat variants (no sort) — same rules as {@link filterLibrary}. */
export function filterLibraryVariants(
  models: LibraryModel[],
  filter: {
    search?: string;
    format?: string;
    publisher?: string;
    producer?: string;
  },
): LibraryModel[] {
  const needle = filter.search?.trim().toLowerCase() ?? '';
  return models.filter((m) => {
    if (filter.format && m.format !== filter.format) return false;
    if (filter.publisher && m.publisher !== filter.publisher) return false;
    if (filter.producer && m.producerSlug !== filter.producer) return false;
    if (!needle) return true;
    const base = stripQuantFromStem(m.name);
    return (
      m.name.toLowerCase().includes(needle) ||
      base.toLowerCase().includes(needle) ||
      m.repoId.toLowerCase().includes(needle) ||
      m.quant.toLowerCase().includes(needle) ||
      m.arch.toLowerCase().includes(needle)
    );
  });
}

/** Filter, merge quants, and sort for the installed-models table. */
export function prepareLibraryGroups(
  models: LibraryModel[],
  filter: {
    search?: string;
    format?: string;
    publisher?: string;
    producer?: string;
    listSort?: LibraryListSort;
  },
  selectedId: string | null,
  serves: ServeRecord[],
  preferences: ReadonlyMap<string, string> = new Map(),
): LibraryVariantGroup[] {
  const filtered = filterLibraryVariants(models, filter);
  const groups = groupLibraryVariants(filtered);
  const sort = filter.listSort ?? DEFAULT_LIBRARY_LIST_SORT;
  return sortLibraryGroups(groups, sort, selectedId, serves, preferences);
}

/** Total bytes across every variant in the shown groups. */
export function totalBytesForGroups(groups: LibraryVariantGroup[]): number {
  return groups.reduce(
    (sum, group) => sum + group.variants.reduce((inner, v) => inner + v.sizeBytes, 0),
    0,
  );
}
