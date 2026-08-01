/**
 * Merged My Models rows — group quants by repo + base name.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CachedModelRow } from '../../src/models/api-client.ts';
import { buildLibrary } from '../../src/models/library.ts';
import {
  groupLibraryVariants,
  prepareLibraryGroups,
  resolveActiveVariant,
  stripQuantFromStem,
  variantGroupKey,
} from '../../src/models/library-group.ts';

function multiQuantRow(): CachedModelRow {
  return {
    repo_id: 'qwen/Qwen3-8B-GGUF',
    size_bytes: 9_000_000_000,
    nb_files: 2,
    has_incomplete: false,
    path: '/home/u/.minnow/models/artifacts/qwen--Qwen3-8B-GGUF',
    is_gguf: true,
    status: 'downloaded',
    gguf_files: [
      {
        name: 'Qwen3-8B-Q4_K_M.gguf',
        rel_path: 'Qwen3-8B-Q4_K_M.gguf',
        size_bytes: 4_000_000_000,
        role: 'model',
        quant: 'Q4_K_M',
      },
      {
        name: 'Qwen3-8B-Q8_0.gguf',
        rel_path: 'Qwen3-8B-Q8_0.gguf',
        size_bytes: 5_000_000_000,
        role: 'model',
        quant: 'Q8_0',
      },
    ],
  };
}

describe('library variant groups', () => {
  test('stripQuantFromStem removes common GGUF quant suffixes', () => {
    assert.equal(stripQuantFromStem('Qwen3-8B-Q4_K_M'), 'Qwen3-8B');
    assert.equal(stripQuantFromStem('gemma-3-27b-Q8_0'), 'gemma-3-27b');
  });

  test('groupLibraryVariants merges quants in the same repo', () => {
    const variants = buildLibrary([multiQuantRow()]);
    assert.equal(variants.length, 2);
    const groups = groupLibraryVariants(variants);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].displayName, 'Qwen3-8B');
    assert.deepEqual(
      groups[0].variants.map((v) => v.quant).sort(),
      ['Q4_K_M', 'Q8_0'],
    );
    assert.equal(variantGroupKey(variants[0]), variantGroupKey(variants[1]));
  });

  test('prepareLibraryGroups keeps separate repos separate', () => {
    const rows = buildLibrary([
      multiQuantRow(),
      {
        ...multiQuantRow(),
        repo_id: 'lmstudio-community/Qwen3-8B-GGUF',
        path: '/models/lms',
        gguf_files: [
          {
            name: 'Qwen3-8B-Q4_K_M.gguf',
            rel_path: 'Qwen3-8B-Q4_K_M.gguf',
            size_bytes: 4_000_000_000,
            role: 'model',
            quant: 'Q4_K_M',
          },
        ],
      },
    ]);
    const groups = prepareLibraryGroups(rows, {}, null, []);
    assert.equal(groups.length, 2);
  });

  test('resolveActiveVariant prefers explicit selection', () => {
    const variants = buildLibrary([multiQuantRow()]);
    const groups = groupLibraryVariants(variants);
    const q8 = variants.find((v) => v.quant === 'Q8_0')!;
    const active = resolveActiveVariant(groups[0], q8.id, [], null);
    assert.equal(active.quant, 'Q8_0');
  });
});
