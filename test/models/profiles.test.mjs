/**
 * Serve profile preset tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeServeProfiles } from '../../server/models/profiles.js';
import { buildLlamaServerArgs } from '../../server/models/llama-args.js';

describe('serve profiles', () => {
  const system = {
    gpuVramGb: 12,
    availableRamGb: 32,
    totalRamGb: 64,
  };

  const model = {
    name: 'demo/7b',
    parameters_raw: 7,
    quantization: 'Q4_K_M',
    is_moe: false,
  };

  test('returns quality, balanced, speed presets', () => {
    const profiles = computeServeProfiles(system, model);
    assert.equal(profiles.length, 3);
    assert.deepEqual(
      profiles.map((p) => p.key),
      ['quality', 'balanced', 'speed'],
    );
  });

  test('balanced profile targets default context length', () => {
    const profiles = computeServeProfiles(system, model);
    const balanced = profiles.find((p) => p.key === 'balanced');
    assert.ok(balanced);
    assert.equal(balanced.ctx, 125_000);
    assert.equal(balanced.cache_type, 'f16');
  });

  test('ggufMeta marks geometry_source gguf with exact header nLayers', () => {
    // Distinctive layer count so this cannot be a 7B parameter-count guess (~32).
    const ggufMeta = {
      arch: 'llama',
      nLayers: 80,
      nKvHeads: 8,
      headDim: 128,
      nEmbd: 4096,
      nVocab: 128256,
    };
    const withHeader = computeServeProfiles(system, model, { ggufMeta });
    const guessed = computeServeProfiles(system, model);
    assert.equal(withHeader[0].geometry_source, 'gguf');
    assert.notEqual(guessed[0].geometry_source, 'gguf');
    // Header-backed estimates differ from heuristic KV sizing (80 vs ~32 layers).
    assert.notEqual(withHeader[0].est_vram_gb, guessed[0].est_vram_gb);
  });

  test('buildLlamaServerArgs includes context and auto-fit (not unclamped ngl)', () => {
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: system,
      modelMeta: model,
    });
    assert.ok(args.includes('-m'));
    assert.ok(args.includes('/tmp/model.gguf'));
    assert.ok(args.includes('--port'));
    assert.ok(args.includes('8085'));
    assert.ok(args.includes('-c'));
    // profileToLlamaArgs used to emit -ngl from the profile with --fit off. Gone.
    assert.equal(args.indexOf('-ngl'), -1);
    const fitIdx = args.indexOf('--fit');
    assert.equal(args[fitIdx + 1], 'on');
  });
});
