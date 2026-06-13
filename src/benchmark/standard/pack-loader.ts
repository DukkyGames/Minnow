/**
 * Load built-in standard benchmark packs (mini + bundled full) and optional user imports.
 */

import arcPack from './packs/arc-challenge-mini.json';
import gsmPack from './packs/gsm8k-mini.json';
import humanevalPack from './packs/humaneval-mini.json';
import mmluPack from './packs/mmlu-mini.json';
import truthfulPack from './packs/truthfulqa-mini.json';
import type { BenchmarkTier } from '../campaign-types.ts';
import type { StandardBenchmarkPack } from './types.ts';

const BUILTIN_PACKS: StandardBenchmarkPack[] = [
  mmluPack as StandardBenchmarkPack,
  arcPack as StandardBenchmarkPack,
  gsmPack as StandardBenchmarkPack,
  humanevalPack as StandardBenchmarkPack,
  truthfulPack as StandardBenchmarkPack,
];

const packById = new Map(BUILTIN_PACKS.map((p) => [p.id, p]));

/** User-imported full-tier packs (runtime, from API) — override bundled full. */
const importedPacks = new Map<string, StandardBenchmarkPack>();

/** Bundled full-tier packs (lazy-loaded JSON). */
const bundledFullPacks = new Map<string, StandardBenchmarkPack>();

const FULL_PACK_LOADERS: Record<string, () => Promise<{ default: StandardBenchmarkPack }>> = {
  'mmlu-mini': () => import('./packs/full/mmlu-mini.json') as Promise<{ default: StandardBenchmarkPack }>,
  'arc-challenge-mini': () => import('./packs/full/arc-challenge-mini.json') as Promise<{ default: StandardBenchmarkPack }>,
  'gsm8k-mini': () => import('./packs/full/gsm8k-mini.json') as Promise<{ default: StandardBenchmarkPack }>,
  'humaneval-mini': () => import('./packs/full/humaneval-mini.json') as Promise<{ default: StandardBenchmarkPack }>,
  'truthfulqa-mini': () => import('./packs/full/truthfulqa-mini.json') as Promise<{ default: StandardBenchmarkPack }>,
};

let preloadPromise: Promise<void> | null = null;

export function listBuiltinStandardPacks(): StandardBenchmarkPack[] {
  return [...BUILTIN_PACKS];
}

/** Load bundled full-tier JSON packs (idempotent). */
export function preloadBundledFullPacks(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const entries = await Promise.all(
        Object.entries(FULL_PACK_LOADERS).map(async ([id, load]) => {
          const mod = await load();
          return [id, mod.default as StandardBenchmarkPack] as const;
        }),
      );
      for (const [id, pack] of entries) {
        bundledFullPacks.set(id, pack);
      }
    })();
  }
  return preloadPromise;
}

/** Pack metadata — mini uses bundled samples; full prefers imported then bundled full. */
export function getStandardPack(id: string, tier: BenchmarkTier = 'mini'): StandardBenchmarkPack | null {
  if (tier === 'full') {
    return importedPacks.get(id) ?? bundledFullPacks.get(id) ?? packById.get(id) ?? null;
  }
  return packById.get(id) ?? importedPacks.get(id) ?? null;
}

export function getImportedStandardPack(id: string): StandardBenchmarkPack | null {
  return importedPacks.get(id) ?? null;
}

export function hasFullTierPack(packId: string): boolean {
  const pack = importedPacks.get(packId) ?? bundledFullPacks.get(packId);
  return Boolean(pack && pack.items.length > 0);
}

/** @deprecated Use hasFullTierPack */
export function hasImportedFullPack(packId: string): boolean {
  return hasFullTierPack(packId);
}

export function registerImportedStandardPack(pack: StandardBenchmarkPack): void {
  importedPacks.set(pack.id, pack);
}

/** Test hook: reset runtime imports between unit tests. */
export function clearImportedStandardPacksForTests(): void {
  importedPacks.clear();
}

/** Test hook: inject bundled full pack without loading JSON. */
export function registerBundledFullPackForTests(pack: StandardBenchmarkPack): void {
  bundledFullPacks.set(pack.id, pack);
}

/** Test hook: reset lazy-load state between unit tests. */
export function resetBundledFullPacksForTests(): void {
  bundledFullPacks.clear();
  preloadPromise = null;
}

/** Items for a pack at the requested tier. */
export function resolveStandardItems(
  packId: string,
  tier: BenchmarkTier,
): StandardBenchmarkPack['items'] {
  if (tier === 'mini') {
    return packById.get(packId)?.items ?? [];
  }
  return (
    importedPacks.get(packId)?.items ??
    bundledFullPacks.get(packId)?.items ??
    []
  );
}

export const STANDARD_PACK_IDS = BUILTIN_PACKS.map((p) => p.id);
