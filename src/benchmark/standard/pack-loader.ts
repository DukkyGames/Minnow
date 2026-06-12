/**
 * Load built-in standard benchmark packs and optional user full-tier datasets.
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

/** User-imported full-tier packs (runtime, from API). */
const importedPacks = new Map<string, StandardBenchmarkPack>();

export function listBuiltinStandardPacks(): StandardBenchmarkPack[] {
  return [...BUILTIN_PACKS];
}

export function getStandardPack(id: string): StandardBenchmarkPack | null {
  return importedPacks.get(id) ?? packById.get(id) ?? null;
}

export function registerImportedStandardPack(pack: StandardBenchmarkPack): void {
  importedPacks.set(pack.id, pack);
}

/** Items for a pack at the requested tier. */
export function resolveStandardItems(
  packId: string,
  tier: BenchmarkTier,
): StandardBenchmarkPack['items'] {
  const pack = getStandardPack(packId);
  if (!pack) return [];
  if (tier === 'mini') return pack.items;
  return pack.items;
}

export const STANDARD_PACK_IDS = BUILTIN_PACKS.map((p) => p.id);
