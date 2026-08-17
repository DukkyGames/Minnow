/**
 * llama-server CLI argument builder tests.
 *
 * Golden argv for Phase 1c: auto GPU uses --fit on / no -ngl / planner -c;
 * manual passes ctx/ngl through; legacy 125k/999 without fit_mode stays auto.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  buildLlamaServerArgs,
  buildLlamaServerLaunch,
  findSiblingMmproj,
} from '../../server/models/llama-args.js';
import { CONTEXT_LADDER } from '../../src/models/launch-plan.mjs';
import { weightsBytesFor } from '../../src/models/memory-model.mjs';

/** Same 8B GQA header launch-plan.test.mjs locked at 12 GB → 32768 f16. */
const GGUF_8B = {
  arch: 'llama',
  nLayers: 32,
  nKvHeads: 8,
  headDim: 128,
  nEmbd: 4096,
  nVocab: 128256,
  trainCtx: 131072,
};

const HW_12GB = { gpuVramGb: 12, availableRamGb: 32, totalRamGb: 64, backend: 'cuda' };
const WEIGHTS_8B_Q4_KM = weightsBytesFor(8, 'Q4_K_M');

function flagValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

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

  test('auto GPU with empty settings: --fit on, no -ngl, ladder -c, flash-attn on, fit-ctx, no swa-full', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      modelMeta: { name: 'demo/8b', parameters_raw: 8, serveWeightsGb: WEIGHTS_8B_Q4_KM / 1024 ** 3 },
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: {},
    });

    assert.equal(flagValue(args, '--fit'), 'on');
    assert.equal(args.indexOf('-ngl'), -1);
    assert.equal(flagValue(args, '-c'), '32768');
    assert.equal(CONTEXT_LADDER.includes(Number(flagValue(args, '-c'))), true);
    assert.ok(Number(flagValue(args, '-c')) <= 32768);
    assert.equal(flagValue(args, '--flash-attn'), 'on');
    assert.equal(flagValue(args, '--fit-ctx'), '4096');
    // 12 GB reserve is max(0.9 GiB, 8% of 12) = 0.96 GiB → 983 MiB (--fit-target units are MiB).
    assert.equal(flagValue(args, '--fit-target'), '983');
    assert.equal(args.includes('--swa-full'), false);
    assert.equal(args.includes('--cache-type-k'), false);
    // Phase 4 LM-Studio-feel defaults. GPU auto leaves ngl unset → no `-t`.
    assert.equal(args.includes('--cont-batching'), true);
    assert.equal(flagValue(args, '--cache-reuse'), '256');
    assert.equal(flagValue(args, '--parallel'), '1');
    assert.equal(args.indexOf('-t'), -1);
    assert.equal(args.indexOf('--alias'), -1);
    assert.equal(args.includes('--no-mmap'), false);
    assert.equal(args.includes('--mlock'), false);
  });

  test('manual GPU passes ctx/ngl unclamped with --fit off and warns when over budget', () => {
    const launch = buildLlamaServerLaunch({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      modelMeta: { name: 'demo/8b', parameters_raw: 8, serveWeightsGb: WEIGHTS_8B_Q4_KM / 1024 ** 3 },
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: { fit_mode: 'manual', ctx: 128000, n_gpu_layers: 32, cache_type: 'f16' },
    });
    const { args, warning } = launch;

    assert.equal(flagValue(args, '-ngl'), '32');
    assert.equal(flagValue(args, '-c'), '128000');
    assert.equal(flagValue(args, '--fit'), 'off');
    assert.ok(warning);
    assert.match(warning, /fit planner/);
    assert.match(warning, /warning: you overrode the fit planner/);
  });

  test('CPU auto: -ngl 0 and --flash-attn auto', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      hardware: { gpuVramGb: 0, availableRamGb: 32, totalRamGb: 64, backend: 'cpu' },
      modelMeta: { name: 'demo/8b', parameters_raw: 8 },
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: {},
    });
    assert.equal(flagValue(args, '-ngl'), '0');
    assert.equal(flagValue(args, '--flash-attn'), 'auto');
    // CPU auto is -ngl 0 with known nLayers → some layers stay on CPU, so `-t`.
    assert.equal(flagValue(args, '-t'), String(os.availableParallelism?.() ?? os.cpus().length));
  });

  test('legacy {ctx:125000, n_gpu_layers:999} without fit_mode stays AUTO (planner wins, no 999)', () => {
    const launch = buildLlamaServerLaunch({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      modelMeta: { name: 'demo/8b', parameters_raw: 8 },
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: { ctx: 125000, n_gpu_layers: 999 },
    });
    const { args, settings } = launch;
    assert.equal(flagValue(args, '--fit'), 'on');
    assert.equal(args.indexOf('-ngl'), -1);
    assert.notEqual(flagValue(args, '-c'), '125000');
    assert.equal(settings.fit_mode, 'auto');
    assert.equal(settings.n_gpu_layers, undefined);
    assert.equal(args.includes('999'), false);
  });

  test('onboarding {ctx, cache_type, fit:true} without fit_mode stays AUTO', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: { ctx: 125000, cache_type: 'f16', fit: true },
    });
    assert.equal(flagValue(args, '--fit'), 'on');
    assert.equal(args.indexOf('-ngl'), -1);
    assert.equal(flagValue(args, '-c'), '32768');
  });

  test('GPU auto without hardware: --fit on, no -ngl, preferred -c (never ngl=999)', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      settings: { ctx: 2048 },
    });
    assert.equal(args.indexOf('-ngl'), -1);
    assert.equal(flagValue(args, '--fit'), 'on');
    assert.equal(flagValue(args, '-c'), '32768');
  });

  test('explicit partial ngl is manual: -ngl 32 and --fit off', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      settings: { fit_mode: 'manual', n_gpu_layers: 32, ctx: 4096 },
    });
    assert.equal(flagValue(args, '-ngl'), '32');
    assert.equal(flagValue(args, '--fit'), 'off');
    assert.equal(flagValue(args, '-c'), '4096');
  });

  test('manual with ngl unset keeps --fit on', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: { fit_mode: 'manual', ctx: 8192, cache_type: 'f16' },
    });
    assert.equal(args.indexOf('-ngl'), -1);
    assert.equal(flagValue(args, '--fit'), 'on');
    assert.equal(flagValue(args, '-c'), '8192');
  });

  test('buildLlamaServerArgs maps cache and batch flags in manual mode', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 9090,
      variant: 'cuda-12.4',
      settings: {
        fit_mode: 'manual',
        ctx: 8192,
        n_gpu_layers: 16,
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

  test('skip_jinja omits --jinja (Phase 3 bad-template retry)', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      settings: { skip_jinja: true, extra_args: ['--jinja', '--no-mmap'] },
    });
    assert.equal(args.includes('--jinja'), false);
    assert.ok(args.includes('--no-mmap'));
  });

  test('buildLlamaServerArgs with ggufMeta auto-fits instead of ngl=999', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: { gpuVramGb: 24, availableRamGb: 32, totalRamGb: 64, backend: 'cuda' },
      modelMeta: { name: 'demo/7b', parameters_raw: 7, quantization: 'Q4_K_M' },
      ggufMeta: {
        arch: 'llama',
        nLayers: 80,
        nKvHeads: 8,
        headDim: 128,
        nEmbd: 4096,
        nVocab: 128256,
      },
    });
    assert.equal(args.indexOf('-ngl'), -1);
    assert.equal(flagValue(args, '--fit'), 'on');
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

  test('--alias uses libraryId unless extra_args already set it', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      libraryId: 'gguf:11111111-1111-1111-1111-111111111111',
      settings: {},
    });
    assert.equal(flagValue(args, '--alias'), 'gguf:11111111-1111-1111-1111-111111111111');

    const skipped = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      libraryId: 'gguf:11111111-1111-1111-1111-111111111111',
      settings: { extra_args: ['--alias', 'user-alias'] },
    });
    assert.equal(flagValue(skipped, '--alias'), 'user-alias');
    assert.equal(skipped.filter((token) => token === '--alias').length, 1);
  });

  test('extra_args --no-cont-batching and --cache-reuse skip the defaults', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: { extra_args: ['--no-cont-batching', '--cache-reuse', '128'] },
    });
    assert.equal(args.includes('--cont-batching'), false);
    assert.equal(args.includes('--no-cont-batching'), true);
    assert.equal(flagValue(args, '--cache-reuse'), '128');
    assert.equal(args.filter((token) => token === '--cache-reuse').length, 1);
  });

  test('quoted extra_args chat-template survives as two argv tokens', () => {
    const fromString = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      settings: { extra_args: '--chat-template "hello world"' },
    });
    const idx = fromString.indexOf('--chat-template');
    assert.ok(idx >= 0);
    assert.equal(fromString[idx + 1], 'hello world');

    // Naive inspector split of the same string must be recovered.
    const fromNaive = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      settings: { extra_args: ['--chat-template', '"hello', 'world"'] },
    });
    const naiveIdx = fromNaive.indexOf('--chat-template');
    assert.equal(fromNaive[naiveIdx + 1], 'hello world');
  });

  test('chat_template setting emits --chat-template with spaces intact', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      settings: { chat_template: 'hello world' },
    });
    const idx = args.indexOf('--chat-template');
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], 'hello world');
  });

  test('no_mmap and mlock settings emit flags; extra_args --no-mmap is not duplicated', () => {
    const fromSettings = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      settings: { no_mmap: true, mlock: true },
    });
    assert.equal(fromSettings.includes('--no-mmap'), true);
    assert.equal(fromSettings.includes('--mlock'), true);

    const fromExtra = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      settings: { no_mmap: true, extra_args: ['--no-mmap'] },
    });
    assert.equal(fromExtra.filter((token) => token === '--no-mmap').length, 1);
  });

  test('manual partial ngl with known nLayers passes -t; full offload does not', () => {
    const expectedThreads = String(os.availableParallelism?.() ?? os.cpus().length);
    const partial = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: { fit_mode: 'manual', n_gpu_layers: 16, ctx: 4096 },
    });
    assert.equal(flagValue(partial, '-ngl'), '16');
    assert.equal(flagValue(partial, '-t'), expectedThreads);

    const full = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: { fit_mode: 'manual', n_gpu_layers: 32, ctx: 4096 },
    });
    assert.equal(flagValue(full, '-ngl'), '32');
    assert.equal(full.indexOf('-t'), -1);
  });

  test('extra_args -t skips the default thread flag', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cpu',
      hardware: { gpuVramGb: 0, availableRamGb: 32, totalRamGb: 64, backend: 'cpu' },
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: { extra_args: ['-t', '4'] },
    });
    assert.equal(flagValue(args, '-t'), '4');
    assert.equal(args.filter((token) => token === '-t').length, 1);
  });

  test('settings.parallel: 2 emits --parallel 2; empty settings stay --parallel 1', () => {
    const two = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HW_12GB,
      modelMeta: { name: 'demo/8b', parameters_raw: 8, serveWeightsGb: WEIGHTS_8B_Q4_KM / 1024 ** 3 },
      weightsBytes: WEIGHTS_8B_Q4_KM,
      ggufMeta: GGUF_8B,
      settings: { parallel: 2 },
    });
    assert.equal(flagValue(two, '--parallel'), '2');
    // Total -c is still a ladder rung; planner multiplies per-slot × parallel.
    assert.ok(Number(flagValue(two, '-c')) > 0);
  });
});
