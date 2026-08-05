import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  estimateServeMemory,
  estimateTransformerLayerCount,
  formatServeMemoryEstimate,
} from '../../src/models/serve-memory-estimate.ts';

describe('serve memory estimate', () => {
  it('maps parameter size to a layer count bucket', () => {
    assert.equal(estimateTransformerLayerCount(7), 32);
    assert.equal(estimateTransformerLayerCount(70), 80);
  });

  it('puts all weights and KV on VRAM when ngl is 999', () => {
    const est = estimateServeMemory({
      weightsGb: 4,
      paramsB: 7,
      ctx: 8192,
      cacheType: 'f16',
      nGpuLayers: 999,
    });
    assert.ok(est.vramGb > 4);
    assert.equal(est.ramGb, 0);
    assert.match(formatServeMemoryEstimate(est), /VRAM/);
  });

  it('puts everything on RAM when ngl is 0', () => {
    const est = estimateServeMemory({
      weightsGb: 4,
      paramsB: 7,
      ctx: 8192,
      nGpuLayers: 0,
    });
    assert.equal(est.vramGb, 0);
    assert.ok(est.ramGb > 4);
    assert.match(formatServeMemoryEstimate(est), /RAM/);
  });

  it('splits weights for partial GPU offload', () => {
    const full = estimateServeMemory({
      weightsGb: 8,
      paramsB: 7,
      ctx: 4096,
      nGpuLayers: 999,
    });
    const half = estimateServeMemory({
      weightsGb: 8,
      paramsB: 7,
      ctx: 4096,
      nGpuLayers: 16,
    });
    assert.ok(half.vramGb < full.vramGb);
    assert.ok(half.ramGb > 0);
    assert.match(formatServeMemoryEstimate(half), /VRAM/);
    assert.match(formatServeMemoryEstimate(half), /RAM/);
  });
});
