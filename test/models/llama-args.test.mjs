/**
 * llama-server CLI argument builder tests.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { buildLlamaServerArgs, findSiblingMmproj } from '../../server/models/llama-args.js';

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

  test('buildLlamaServerArgs defaults ngl=999 on GPU variant with fit off', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      settings: { ctx: 2048 },
    });
    const nglIdx = args.indexOf('-ngl');
    assert.equal(args[nglIdx + 1], '999');
    const fitIdx = args.indexOf('--fit');
    assert.ok(fitIdx >= 0);
    assert.equal(args[fitIdx + 1], 'off');
  });

  test('buildLlamaServerArgs omits ngl when fit is on', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      settings: { fit: true, n_gpu_layers: 999, ctx: 4096 },
    });
    assert.equal(args.indexOf('-ngl'), -1);
    const fitIdx = args.indexOf('--fit');
    assert.equal(args[fitIdx + 1], 'on');
  });

  test('buildLlamaServerArgs passes explicit partial ngl with fit off', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      settings: { n_gpu_layers: 32, ctx: 4096 },
    });
    const nglIdx = args.indexOf('-ngl');
    assert.equal(args[nglIdx + 1], '32');
    const fitIdx = args.indexOf('--fit');
    assert.equal(args[fitIdx + 1], 'off');
  });

  test('buildLlamaServerArgs passes fit as on|off value', () => {
    const withFit = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      settings: { fit: true },
    });
    const fitIdx = withFit.indexOf('--fit');
    assert.equal(fitIdx, withFit.length - 2);
    assert.equal(withFit[fitIdx + 1], 'on');

    const withoutFit = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      settings: { fit: false },
    });
    const offIdx = withoutFit.indexOf('--fit');
    assert.equal(offIdx, withoutFit.length - 2);
    assert.equal(withoutFit[offIdx + 1], 'off');
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
    assert.ok(args.includes('--jinja'));
  });

  test('buildLlamaServerArgs passes --mmproj when a projector path is set', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/Qwen3.8-27B-Q4_K_M.gguf',
      port: 8085,
      variant: 'cpu',
      mmprojPath: '/tmp/mmproj-F16.gguf',
    });
    const idx = args.indexOf('--mmproj');
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], '/tmp/mmproj-F16.gguf');
    assert.ok(args.includes('--jinja'));
  });

  test('buildLlamaServerArgs does not duplicate --jinja from extra_args', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      settings: { extra_args: ['--jinja'] },
    });
    assert.equal(args.filter((token) => token === '--jinja').length, 1);
  });

  test('user ctx 2048 wins over the balanced 125k profile default', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      profileKey: 'balanced',
      hardware: { gpuVramGb: 12, availableRamGb: 32, totalRamGb: 64, backend: 'cuda' },
      modelMeta: { name: 'demo', parameters_raw: 7, quantization: 'Q4_K_M' },
      settings: { ctx: 2048, n_gpu_layers: 999, cache_type: 'f16' },
    });
    const cIdx = args.indexOf('-c');
    assert.ok(cIdx >= 0);
    assert.equal(args[cIdx + 1], '2048');
  });

  test('findSiblingMmproj prefers mmproj-F16 next to the weights', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-mmproj-'));
    await fsp.writeFile(path.join(dir, 'Qwen3.8-27B-Q4_K_M.gguf'), '');
    await fsp.writeFile(path.join(dir, 'mmproj-BF16.gguf'), '');
    await fsp.writeFile(path.join(dir, 'mmproj-F16.gguf'), '');
    const found = await findSiblingMmproj(path.join(dir, 'Qwen3.8-27B-Q4_K_M.gguf'));
    assert.equal(found, path.join(dir, 'mmproj-F16.gguf'));
    await fsp.rm(dir, { recursive: true, force: true });
  });
});
