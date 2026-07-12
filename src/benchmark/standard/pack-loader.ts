/**
 * Load built-in standard benchmark packs (mini + bundled full) and optional user imports.
 * Pack JSON lives under `public/benchmark-packs/` and is fetched at runtime — never bundled as JS.
 */

import type { BenchmarkTier } from '../campaign-types.ts';
import type { StandardBenchmarkPack } from './types.ts';

const PACK_IDS = [
  'mmlu-mini',
  'arc-challenge-mini',
  'gsm8k-mini',
  'humaneval-mini',
  'truthfulqa-mini',
] as const;

type BuiltinPackId = (typeof PACK_IDS)[number];

/** User-imported full-tier packs (runtime, from API) — override bundled full. */
const importedPacks = new Map<string, StandardBenchmarkPack>();

/** Bundled full-tier packs (fetched JSON). */
const bundledFullPacks = new Map<string, StandardBenchmarkPack>();

/** Cached mini-tier packs (fetched JSON). */
const miniPackCache = new Map<string, StandardBenchmarkPack>();

let preloadPromise: Promise<void> | null = null;
let miniPreloadPromise: Promise<void> | null = null;

function packUrl(tier: 'mini' | 'full', id: string): string {
  const base = import.meta.env?.BASE_URL ?? './';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}benchmark-packs/${tier}/${id}.json`;
}

async function fetchPack(tier: 'mini' | 'full', id: string): Promise<StandardBenchmarkPack> {
  const res = await fetch(packUrl(tier, id));
  if (!res.ok) {
    throw new Error(`Failed to load benchmark pack ${id} (${tier}): HTTP ${res.status}`);
  }
  return (await res.json()) as StandardBenchmarkPack;
}

/** Load all mini-tier packs (idempotent). Call from benchmark UI init before sync catalog access. */
export function preloadMiniPacks(): Promise<void> {
  if (!miniPreloadPromise) {
    miniPreloadPromise = (async () => {
      const packs = await Promise.all(PACK_IDS.map((id) => fetchPack('mini', id)));
      for (const pack of packs) {
        miniPackCache.set(pack.id, pack);
      }
    })();
  }
  return miniPreloadPromise;
}

export function listBuiltinStandardPacks(): StandardBenchmarkPack[] {
  return PACK_IDS.map((id) => miniPackCache.get(id)).filter(
    (pack): pack is StandardBenchmarkPack => pack != null,
  );
}

/** Load bundled full-tier JSON packs (idempotent). */
export function preloadBundledFullPacks(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const entries = await Promise.all(
        PACK_IDS.map(async (id) => {
          const pack = await fetchPack('full', id);
          return [id, pack] as const;
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
    return importedPacks.get(id) ?? bundledFullPacks.get(id) ?? miniPackCache.get(id) ?? null;
  }
  return miniPackCache.get(id) ?? null;
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

/** Test hook: inject mini pack without fetch (Node tests). */
export function registerMiniPackForTests(pack: StandardBenchmarkPack): void {
  miniPackCache.set(pack.id, pack);
}

/** Test hook: reset lazy-load state between unit tests. */
export function resetBundledFullPacksForTests(): void {
  bundledFullPacks.clear();
  preloadPromise = null;
}

/** Test hook: reset mini pack cache between unit tests. */
export function resetMiniPacksForTests(): void {
  miniPackCache.clear();
  miniPreloadPromise = null;
}

/** Items for a pack at the requested tier. */
export function resolveStandardItems(
  packId: string,
  tier: BenchmarkTier,
): StandardBenchmarkPack['items'] {
  if (tier === 'mini') {
    return getStandardPack(packId, 'mini')?.items ?? [];
  }
  return (
    importedPacks.get(packId)?.items ??
    bundledFullPacks.get(packId)?.items ??
    []
  );
}

export const STANDARD_PACK_IDS = [...PACK_IDS];
