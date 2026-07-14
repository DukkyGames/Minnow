/**
 * Partial GPU offload suggestions from block counts.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeServeProfiles, suggestGpuLayers } from '../../server/models/profiles.js';

describe('profiles partial offload', () => {
  test('suggestGpuLayers caps at block count', () => {
    assert.equal(suggestGpuLayers(32, 8, 1, 1), 0);
    assert.equal(suggestGpuLayers(32, 8, 20, 1), 32);
  });

  test('computeServeProfiles uses blockCount for n_gpu_layers', () => {
    const hardware = { gpuVramGb: 8 };
    const model = { parameter_count: '7B', quantization: 'Q4_K_M' };
    const profiles = computeServeProfiles(hardware, model, {
      serveWeightsGb: 4,
      blockCount: 32,
    });
    assert.ok(profiles.every((p) => p.n_gpu_layers <= 32));
  });
});
