/**
 * Split-GGUF filename expansion and sibling-existence guard.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  assertSplitGgufSiblings,
  expandSplitGgufFilenames,
  parseSplitGgufFilename,
} from '../../server/models/split-gguf.js';

describe('split GGUF helpers', () => {
  test('parseSplitGgufFilename reads index, count, and directory prefix', () => {
    const parsed = parseSplitGgufFilename('gguf/model-Q4_K_M-00001-of-00003.gguf');
    assert.equal(parsed?.dir, 'gguf');
    assert.equal(parsed?.prefix, 'model-Q4_K_M');
    assert.equal(parsed?.index, 1);
    assert.equal(parsed?.count, 3);
    assert.equal(parseSplitGgufFilename('plain-Q4_K_M.gguf'), null);
  });

  test('expandSplitGgufFilenames returns all shards and asserts listed count', () => {
    const listed = [
      'model-Q8_0.gguf',
      'model-Q4_K_M-00001-of-00003.gguf',
      'model-Q4_K_M-00002-of-00003.gguf',
      'model-Q4_K_M-00003-of-00003.gguf',
    ];
    assert.deepEqual(expandSplitGgufFilenames('model-Q4_K_M-00002-of-00003.gguf', listed), [
      'model-Q4_K_M-00001-of-00003.gguf',
      'model-Q4_K_M-00002-of-00003.gguf',
      'model-Q4_K_M-00003-of-00003.gguf',
    ]);
    assert.deepEqual(expandSplitGgufFilenames('plain-Q4_K_M.gguf', listed), ['plain-Q4_K_M.gguf']);
  });

  test('expandSplitGgufFilenames throws when a sibling is missing from the listing', () => {
    assert.throws(
      () =>
        expandSplitGgufFilenames('model-00001-of-00003.gguf', [
          'model-00001-of-00003.gguf',
          'model-00002-of-00003.gguf',
        ]),
      /expects 3 shards, but the repo lists 2/,
    );
  });

  describe('assertSplitGgufSiblings', () => {
    /** @type {string} */
    let dir;

    before(async () => {
      dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-split-gguf-'));
    });

    after(async () => {
      await fsp.rm(dir, { recursive: true, force: true });
    });

    test('no-ops when splitCount is 1', async () => {
      const shard1 = path.join(dir, 'solo.gguf');
      await fsp.writeFile(shard1, 'GGUF');
      await assertSplitGgufSiblings(shard1, 1);
    });

    test('accepts a complete 00001..00003 set', async () => {
      const shard1 = path.join(dir, 'weights-00001-of-00003.gguf');
      await fsp.writeFile(shard1, 'GGUF');
      await fsp.writeFile(path.join(dir, 'weights-00002-of-00003.gguf'), 'GGUF');
      await fsp.writeFile(path.join(dir, 'weights-00003-of-00003.gguf'), 'GGUF');
      await assertSplitGgufSiblings(shard1, 3);
    });

    test('throws when a sibling is missing', async () => {
      const shard1 = path.join(dir, 'missing-00001-of-00003.gguf');
      await fsp.writeFile(shard1, 'GGUF');
      await fsp.writeFile(path.join(dir, 'missing-00002-of-00003.gguf'), 'GGUF');
      await assert.rejects(
        () => assertSplitGgufSiblings(shard1, 3),
        /missing missing-00003-of-00003\.gguf/,
      );
    });

    test('refuses -m pointed at shard 00002', async () => {
      const shard2 = path.join(dir, 'weights-00002-of-00003.gguf');
      await assert.rejects(
        () => assertSplitGgufSiblings(shard2, 3),
        /must point at shard 00001/,
      );
    });
  });
});
