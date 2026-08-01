/**
 * My Models table column sort helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { LibraryModel } from '../../src/models/library.ts';
import {
  cycleLibraryListSort,
  sortFromPreset,
  sortLibraryForList,
} from '../../src/models/library-sort.ts';

function row(overrides: Partial<LibraryModel> = {}): LibraryModel {
  return {
    id: 'gguf:test:a.gguf',
    name: 'Alpha',
    repoId: 'org/Alpha',
    publisher: 'org',
    producerSlug: 'org',
    producerName: 'Org',
    producerLogoId: 'alpha',
    format: 'GGUF',
    quant: 'Q4_K_M',
    arch: 'llama',
    domain: 'chat',
    paramsB: 8,
    contextLength: 8192,
    capabilities: [],
    sizeBytes: 4_000_000_000,
    path: '/a.gguf',
    fileName: 'a.gguf',
    source: 'downloaded',
    servable: true,
    incomplete: false,
    isMoe: false,
    ...overrides,
  };
}

describe('library list sort', () => {
  test('preset maps to list sort state', () => {
    assert.deepEqual(sortFromPreset('size'), { key: 'size', direction: 'desc' });
    assert.deepEqual(sortFromPreset('producer'), { key: 'maker', direction: 'asc' });
  });

  test('cycles direction on the same column', () => {
    const first = cycleLibraryListSort({ key: 'name', direction: 'asc' }, 'name');
    assert.deepEqual(first, { key: 'name', direction: 'desc' });
    const second = cycleLibraryListSort(first, 'name');
    assert.deepEqual(second, { key: 'name', direction: 'asc' });
  });

  test('sorts by size descending', () => {
    const models = [
      row({ id: '1', name: 'small', sizeBytes: 1 }),
      row({ id: '2', name: 'large', sizeBytes: 9 }),
    ];
    const sorted = sortLibraryForList(models, { key: 'size', direction: 'desc' });
    assert.equal(sorted[0].name, 'large');
  });
});
