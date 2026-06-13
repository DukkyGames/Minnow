import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  clearImportedStandardPacksForTests,
  getStandardPack,
  hasFullTierPack,
  registerBundledFullPackForTests,
  registerImportedStandardPack,
  resetBundledFullPacksForTests,
  resolveStandardItems,
} from '../../src/benchmark/standard/pack-loader.ts';
import type { StandardBenchmarkPack } from '../../src/benchmark/standard/types.ts';

const MINI_PACK_ID = 'mmlu-mini';

const FULL_IMPORT: StandardBenchmarkPack = {
  id: MINI_PACK_ID,
  label: 'MMLU full',
  category: 'reasoning',
  description: 'Imported full MMLU',
  scoring: 'mcq',
  miniCount: 5,
  fullCount: 100,
  items: [
    {
      id: 'full-1',
      prompt: 'Full tier question 1',
      groundTruth: 'A',
      choices: ['A', 'B'],
      category: 'reasoning',
    },
    {
      id: 'full-2',
      prompt: 'Full tier question 2',
      groundTruth: 'B',
      choices: ['A', 'B'],
      category: 'reasoning',
    },
  ],
};

describe('standard pack-loader tier resolution', () => {
  beforeEach(() => {
    clearImportedStandardPacksForTests();
    resetBundledFullPacksForTests();
    registerBundledFullPackForTests(FULL_IMPORT);
  });

  it('mini tier uses bundled sample items', () => {
    const items = resolveStandardItems(MINI_PACK_ID, 'mini');
    assert.ok(items.length > 0);
    assert.ok(items.every((item) => !item.id.startsWith('full-')));
  });

  it('full tier uses bundled full dataset items', () => {
    const items = resolveStandardItems(MINI_PACK_ID, 'full');
    assert.equal(items.length, 2);
    assert.equal(items[0]?.id, 'full-1');
  });

  it('imported full pack overrides bundled full', () => {
    registerImportedStandardPack({
      ...FULL_IMPORT,
      items: [{ id: 'imported-1', prompt: 'q', groundTruth: 'A', category: 'reasoning' }],
    });
    const items = resolveStandardItems(MINI_PACK_ID, 'full');
    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, 'imported-1');
  });

  it('full tier returns empty when no bundled or imported pack exists', () => {
    resetBundledFullPacksForTests();
    assert.deepEqual(resolveStandardItems('arc-challenge-mini', 'full'), []);
  });

  it('hasFullTierPack reflects bundled or imported items', () => {
    assert.equal(hasFullTierPack(MINI_PACK_ID), true);
    assert.equal(hasFullTierPack('gsm8k-mini'), false);
  });

  it('getStandardPack uses tier for scoring metadata', () => {
    const mini = getStandardPack(MINI_PACK_ID, 'mini');
    const full = getStandardPack(MINI_PACK_ID, 'full');
    assert.ok(mini);
    assert.ok(full);
    assert.match(mini.description, /Sample multiple-choice/i);
    assert.equal(full.description, 'Imported full MMLU');
  });
});
