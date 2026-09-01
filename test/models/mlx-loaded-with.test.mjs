/**
 * mlx-lm inspector "Loaded with" copy.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mlxLoadedWithRows } from '../../src/models/mlx-loaded-with.ts';

describe('mlxLoadedWithRows', () => {
  test('lists snapshot, quant, version, port, and context', () => {
    const rows = mlxLoadedWithRows({
      snapshotPath: '/Users/me/.minnow/models/artifacts/qwen',
      quant: 'mlx-4bit',
      mlxLmVersion: '0.31.3',
      port: 8087,
      contextLength: 32768,
    });
    assert.deepEqual(
      rows.map((r) => r.label),
      ['Snapshot', 'Quant', 'mlx-lm', 'Port', 'Context'],
    );
    assert.equal(rows.find((r) => r.label === 'Quant')?.value, 'mlx-4bit');
    assert.equal(rows.find((r) => r.label === 'mlx-lm')?.value, '0.31.3');
    assert.equal(rows.find((r) => r.label === 'Port')?.value, '8087');
    assert.equal(rows.find((r) => r.label === 'Context')?.value, '32768');
  });

  test('fills quant and context from the library row when the snapshot omits them', () => {
    const rows = mlxLoadedWithRows(
      {
        snapshotPath: '/tmp/snap',
        quant: null,
        mlxLmVersion: '0.31.3',
        port: 8087,
        contextLength: null,
      },
      { quant: 'mlx-8bit', contextLength: 8192 },
    );
    assert.equal(rows.find((r) => r.label === 'Quant')?.value, 'mlx-8bit');
    assert.equal(rows.find((r) => r.label === 'Context')?.value, '8192');
  });

  test('empty settings without a fallback are not llama "no stored launch flags"', () => {
    assert.deepEqual(mlxLoadedWithRows(null), []);
  });
});
