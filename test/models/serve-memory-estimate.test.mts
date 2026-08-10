import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  estimateServeMemory,
  estimateTransformerLayerCount,
  formatServeMemoryEstimate,
} from '../../src/models/serve-memory-estimate.ts';

/** Llama-3.1-8B, as its GGUF header states it. */
const LLAMA_8B = {
  arch: 'llama',
  nLayers: 32,
  nKvHeads: 8,
  headDim: 128,
  nEmbd: 4096,
  nVocab: 128256,
};

describe('serve memory estimate', () => {
  it('takes the layer count from the GGUF header when one is available', () => {
    assert.equal(estimateTransformerLayerCount(8, { gguf: LLAMA_8B }), 32);
    // Qwen3-32B is 64 blocks; the old parameter-size bucket said 48.
    assert.equal(estimateTransformerLayerCount(32.76, { arch: 'qwen3' }), 64);
    assert.equal(estimateTransformerLayerCount(70, { arch: 'llama' }), 80);
  });

  it('puts all weights and KV on VRAM when ngl is 999', () => {
    const est = estimateServeMemory({
      weightsGb: 4.58,
      paramsB: 8,
      ctx: 8192,
      cacheType: 'f16',
      nGpuLayers: 999,
      gguf: LLAMA_8B,
    });
    assert.ok(est.vramGb > 4.58);
    // Only the small fixed host allocation stays off the GPU, which the hint line hides.
    assert.ok(est.ramGb < 0.5);
    assert.equal(est.geometrySource, 'gguf');
    assert.equal(formatServeMemoryEstimate(est), `~${est.vramGb} GB VRAM`);
  });

  it('sizes the KV cache from attention geometry, not parameter count', () => {
    const at = (ctx: number) =>
      estimateServeMemory({ weightsGb: 0, paramsB: 8, ctx, gguf: LLAMA_8B, nGpuLayers: 999 });

    // 2 (K+V) * 32 layers * 8 kv heads * 128 head dim * 2 bytes = 128 KiB/token, so 8192
    // tokens is exactly 1 GiB. The old formula called this 0.53 GB.
    assert.equal(Math.round((at(8192).totalGb - at(0).totalGb) * 100) / 100, 1.0);
    assert.equal(at(8192).kvGbPer1kTokens, 0.12);
  });

  it('charges a quantized KV cache less than f16', () => {
    const f16 = estimateServeMemory({
      weightsGb: 4.58,
      paramsB: 8,
      ctx: 32768,
      cacheType: 'f16',
      gguf: LLAMA_8B,
    });
    const q80 = estimateServeMemory({
      weightsGb: 4.58,
      paramsB: 8,
      ctx: 32768,
      cacheType: 'q8_0',
      gguf: LLAMA_8B,
    });
    assert.ok(q80.vramGb < f16.vramGb);
    // q8_0 stores 32 elements in 34 bytes — a shade over half of f16.
    assert.ok(f16.vramGb - q80.vramGb > 1.8);
  });

  it('discounts sliding-window layers', () => {
    // Gemma 3 12B keeps full attention on 8 of 48 blocks; the other 40 cap at a 1024 window.
    // Weights are zeroed so the assertion is about the cache alone: ~2.5 GiB, not ~12.
    const gemma = estimateServeMemory({ weightsGb: 0, paramsB: 12.2, ctx: 32768, arch: 'gemma3' });
    const asIfDense = estimateServeMemory({
      weightsGb: 0,
      paramsB: 12.2,
      ctx: 32768,
      gguf: { nLayers: 48, nKvHeads: 8, headDim: 256, nEmbd: 3840, nVocab: 262144 },
    });
    assert.equal(gemma.layerCount, 48);
    assert.ok(gemma.vramGb < asIfDense.vramGb / 3);
  });

  it('puts everything on RAM when ngl is 0', () => {
    const est = estimateServeMemory({
      weightsGb: 4.58,
      paramsB: 8,
      ctx: 8192,
      nGpuLayers: 0,
      gguf: LLAMA_8B,
    });
    assert.equal(est.vramGb, 0);
    assert.ok(est.ramGb > 4.58);
    assert.match(formatServeMemoryEstimate(est), /RAM/);
  });

  it('splits the KV cache along with the layers on partial offload', () => {
    const full = estimateServeMemory({
      weightsGb: 8,
      paramsB: 8,
      ctx: 32768,
      nGpuLayers: 999,
      gguf: LLAMA_8B,
    });
    const half = estimateServeMemory({
      weightsGb: 8,
      paramsB: 8,
      ctx: 32768,
      nGpuLayers: 16,
      gguf: LLAMA_8B,
    });
    assert.ok(half.vramGb < full.vramGb);
    assert.ok(half.ramGb > 0);
    // Half the layers means half the cache stays in RAM — 4 GiB of KV at 32k, so the VRAM
    // figure must drop by clearly more than half the weights alone (4 GiB) would explain.
    assert.ok(full.vramGb - half.vramGb > 5);
    assert.match(formatServeMemoryEstimate(half), /VRAM/);
    assert.match(formatServeMemoryEstimate(half), /RAM/);
  });

  it('falls back to architecture geometry when no header is available', () => {
    const est = estimateServeMemory({
      weightsGb: 4.68,
      paramsB: 8.19,
      ctx: 8192,
      arch: 'qwen3',
      name: 'Qwen3-8B',
    });
    assert.equal(est.geometrySource, 'family');
    assert.equal(est.layerCount, 36);
  });
});
