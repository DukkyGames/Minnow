/**
 * llama-server CLI argument builder tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildLlamaServerArgs } from '../../server/models/llama-args.js';

describe('llama args', () => {
  test('buildLlamaServerArgs forces ngl=0 on CPU variant', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      settings: { n_gpu_layers: 999, ctx: 4096 },
    });
    const nglIdx = args.indexOf('-ngl');
    assert.ok(nglIdx >= 0);
    assert.equal(args[nglIdx + 1], '0');
  });

  test('buildLlamaServerArgs defaults ngl=999 on GPU variant', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      settings: { ctx: 2048 },
    });
    const nglIdx = args.indexOf('-ngl');
    assert.equal(args[nglIdx + 1], '999');
  });

  test('buildLlamaServerArgs maps cache and batch flags', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 9090,
      variant: 'cuda-12.4',
      settings: {
        ctx: 8192,
        cache_type: 'q4_0',
        batch_size: 512,
        extra_args: ['--no-mmap'],
      },
    });
    assert.deepEqual(args.slice(0, 6), ['-m', '/tmp/model.gguf', '--host', '127.0.0.1', '--port', '9090']);
    assert.ok(args.includes('-c'));
    assert.ok(args.includes('8192'));
    assert.ok(args.includes('--cache-type-k'));
    assert.ok(args.includes('q4_0'));
    assert.ok(args.includes('-b'));
    assert.ok(args.includes('512'));
    assert.ok(args.includes('--no-mmap'));
  });
});
