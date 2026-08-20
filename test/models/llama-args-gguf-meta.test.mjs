/**
 * Prove buildLlamaServerArgs forwards ggufMeta into computeServeProfiles.
 * mock.module wraps profiles.js so we can inspect opts; argv is auto-fit (Phase 1c).
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

const { computeServeProfiles } = await import('../../server/models/profiles.js');
const { geometryFromGgufMetadata } = await import('../../src/models/model-geometry.mjs');

/** Opts objects computeServeProfiles actually received from buildLlamaServerArgs. */
const profileCalls = [];

mock.module('../../server/models/profiles.js', {
  namedExports: {
    computeServeProfiles(system, model, opts) {
      profileCalls.push({ system, model, opts });
      return computeServeProfiles(system, model, opts);
    },
  },
});

const { buildLlamaServerArgs } = await import('../../server/models/llama-args.js');

/** Parsed-header shape geometryFromGgufMetadata accepts — no real GGUF file needed. */
const GGUF_META = {
  arch: 'llama',
  nLayers: 80,
  nKvHeads: 8,
  headDim: 128,
  nEmbd: 4096,
  nVocab: 128256,
  layerBytes: 4_000_000_000,
  fixedBytes: 500_000_000,
};

const HARDWARE = {
  gpuVramGb: 24,
  availableRamGb: 32,
  totalRamGb: 64,
  backend: 'cuda',
};

const MODEL_META = { name: 'demo/7b', parameters_raw: 7, quantization: 'Q4_K_M' };

describe('buildLlamaServerArgs GGUF metadata forwarding', () => {
  test('forwards ggufMeta so profile geometry_source is gguf with header nLayers', () => {
    profileCalls.length = 0;
    const args = buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HARDWARE,
      modelMeta: MODEL_META,
      ggufMeta: GGUF_META,
    });

    assert.equal(profileCalls.length, 1);
    assert.equal(profileCalls[0].opts.ggufMeta, GGUF_META);

    // Re-run with the captured opts — same object the launch path actually used.
    const profiles = computeServeProfiles(
      profileCalls[0].system,
      profileCalls[0].model,
      profileCalls[0].opts,
    );
    assert.equal(profiles[0].geometry_source, 'gguf');
    assert.equal(geometryFromGgufMetadata(GGUF_META)?.nLayers, 80);

    // Phase 1c: planner owns ngl/fit. Header forwarding must not resurrect 999.
    assert.equal(args.indexOf('-ngl'), -1);
    const fitIdx = args.indexOf('--fit');
    assert.equal(args[fitIdx + 1], 'on');
  });

  test('passes null ggufMeta through when the header is missing', () => {
    profileCalls.length = 0;
    buildLlamaServerArgs({
      modelPath: '/tmp/model.gguf',
      port: 8085,
      variant: 'cuda-12.4',
      hardware: HARDWARE,
      modelMeta: MODEL_META,
      ggufMeta: null,
    });
    assert.equal(profileCalls.length, 1);
    assert.equal(profileCalls[0].opts.ggufMeta, null);
    const profiles = computeServeProfiles(
      profileCalls[0].system,
      profileCalls[0].model,
      profileCalls[0].opts,
    );
    assert.notEqual(profiles[0].geometry_source, 'gguf');
  });
});
