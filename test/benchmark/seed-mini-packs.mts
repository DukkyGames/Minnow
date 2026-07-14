/**
 * Test helper: seed mini benchmark packs from public/ without a running dev server.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StandardBenchmarkPack } from '../../src/benchmark/standard/types.ts';
import { registerMiniPackForTests } from '../../src/benchmark/standard/pack-loader.ts';

const MINI_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/benchmark-packs/mini',
);

const PACK_IDS = [
  'mmlu-mini',
  'arc-challenge-mini',
  'gsm8k-mini',
  'humaneval-mini',
  'truthfulqa-mini',
] as const;

/** Load all built-in mini packs into the in-memory cache for Node unit tests. */
export function seedBuiltinMiniPacksForTests(): void {
  for (const id of PACK_IDS) {
    const file = path.join(MINI_DIR, `${id}.json`);
    const pack = JSON.parse(readFileSync(file, 'utf8')) as StandardBenchmarkPack;
    registerMiniPackForTests(pack);
  }
}
