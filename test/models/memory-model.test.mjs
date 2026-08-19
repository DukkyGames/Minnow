import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeBufferBytes,
  estimateRunMemory,
  fullAttentionLayers,
  GIB,
  kvCacheBytes,
  maxContextForBudget,
  weightsBytesFor,
} from '../../src/models/memory-model.mjs';
import { resolveGeometry } from '../../src/models/model-geometry.mjs';

const geom = (over = {}) => ({
  nLayers: 32,
  nKvHeads: 8,
  headDim: 128,
  nEmbd: 4096,
  nVocab: 128256,
  nExperts: 0,
  swaWindow: 0,
  swaPeriod: 1,
  source: 'gguf',
  ...over,
});

describe('kv cache sizing', () => {
  it('is 2 * layers * kv heads * head dim * bytes per token', () => {
    // Llama-3.1-8B at f16: 128 KiB/token, so 8192 tokens is exactly 1 GiB.
    assert.equal(kvCacheBytes(geom(), 8192, 'f16'), GIB);
  });

  it('does not change when parameter count does', () => {
    // Qwen3-0.6B and Qwen3-8B share a KV geometry apart from block count. The old formula
    // scaled with parameters and so was ~11x apart on these two.
    const small = resolveGeometry({ architecture: 'qwen3', paramsB: 0.75 });
    const large = resolveGeometry({ architecture: 'qwen3', paramsB: 8.19 });
    // The only difference is 36 blocks against 28 — an 11x parameter gap moves nothing else.
    const ratio = kvCacheBytes(large, 8192) / kvCacheBytes(small, 8192);
    assert.equal(ratio, 36 / 28);
  });

  it('charges quantized cache types by their ggml block layout', () => {
    const f16 = kvCacheBytes(geom(), 8192, 'f16');
    // q8_0 stores 32 elements in 34 bytes.
    assert.equal(kvCacheBytes(geom(), 8192, 'q8_0'), (f16 / 2) * (34 / 32));
    assert.equal(kvCacheBytes(geom(), 8192, 'q4_0'), (f16 / 2) * (18 / 32));
  });

  it('falls back to f16 for an unknown cache type', () => {
    assert.equal(kvCacheBytes(geom(), 8192, 'nonsense'), kvCacheBytes(geom(), 8192, 'f16'));
  });

  it('caps sliding-window layers at their window plus a micro-batch', () => {
    const swa = geom({ nLayers: 48, headDim: 256, swaWindow: 1024, swaPeriod: 6 });
    assert.equal(fullAttentionLayers(swa), 8);

    const bytes = kvCacheBytes(swa, 32768, 'f16', { ubatch: 512 });
    const perLayerToken = 2 * 8 * 256 * 2;
    assert.equal(bytes, perLayerToken * (8 * 32768 + 40 * 1536));
  });

  it('lets an exact per-layer count override the period', () => {
    const exact = geom({ nLayers: 30, swaWindow: 1024, swaPeriod: 6, nFullAttentionLayers: 5 });
    assert.equal(fullAttentionLayers(exact), 5);
  });

  it('uses the narrower head size on windowed layers when the model has one', () => {
    const wide = geom({ nLayers: 6, headDim: 512, swaWindow: 1024, nFullAttentionLayers: 2 });
    const narrow = { ...wide, swaHeadDim: 256 };
    assert.ok(kvCacheBytes(narrow, 32768) < kvCacheBytes(wide, 32768));
  });

  it('sizes K and V separately when they carry different quantizations', () => {
    const f16 = kvCacheBytes(geom(), 8192, 'f16');
    const q8 = kvCacheBytes(geom(), 8192, 'q8_0');
    // A mixed pair is the mean of the two symmetric caches, not either one doubled.
    const mixed = kvCacheBytes(geom(), 8192, { k: 'f16', v: 'q8_0' });
    assert.equal(mixed, (f16 + q8) / 2);
    // A pair naming the same type on both sides matches the string form exactly.
    assert.equal(kvCacheBytes(geom(), 8192, { k: 'q8_0', v: 'q8_0' }), q8);
  });

  it('drops the sliding-window saving under --swa-full', () => {
    const swa = geom({ nLayers: 48, headDim: 256, swaWindow: 1024, swaPeriod: 6 });
    const windowed = kvCacheBytes(swa, 32768, 'f16', { ubatch: 512 });
    const full = kvCacheBytes(swa, 32768, 'f16', { ubatch: 512, swaFull: true });
    assert.ok(full > windowed);
    // Every layer now carries the whole context, so it matches a non-windowed model.
    const dense = geom({ nLayers: 48, headDim: 256, swaWindow: 0, swaPeriod: 1 });
    assert.equal(full, kvCacheBytes(dense, 32768, 'f16', { ubatch: 512 }));
  });

  it('charges only the full-attention layers on a linear-attention hybrid', () => {
    // Qwen3.5-9B: 8 of 32 layers grow a cache; the rest hold a constant-size state.
    const hybrid = geom({ nLayers: 32, nKvHeads: 4, headDim: 256, swaWindow: 0, swaPeriod: 4 });
    const dense = geom({ nLayers: 32, nKvHeads: 4, headDim: 256, swaWindow: 0, swaPeriod: 1 });
    const ratio = kvCacheBytes(dense, 125000) / kvCacheBytes(hybrid, 125000);
    assert.ok(ratio > 3.5 && ratio < 4.1, `ratio ${ratio}`);
  });
});

describe('compute buffer', () => {
  it('is dominated by the logits tensor, so vocabulary drives it', () => {
    const bigVocab = computeBufferBytes(geom({ nEmbd: 896, nVocab: 152064 }));
    const smallVocab = computeBufferBytes(geom({ nEmbd: 4096, nVocab: 32000 }));
    assert.ok(bigVocab > smallVocab);
  });
});

describe('run memory', () => {
  it('keeps everything on the GPU at full offload', () => {
    const est = estimateRunMemory({
      geometry: geom(),
      weightsBytes: 4.58 * GIB,
      ctx: 8192,
      backend: 'cuda',
    });
    assert.equal(est.breakdown.weightsRam, 0);
    assert.equal(est.breakdown.kvRam, 0);
    assert.ok(est.vramGb > 5.5 && est.vramGb < 7);
  });

  it('splits the KV cache with the layers on partial offload', () => {
    const est = estimateRunMemory({
      geometry: geom(),
      weightsBytes: 8 * GIB,
      ctx: 8192,
      nGpuLayers: 16,
      backend: 'cuda',
    });
    assert.equal(est.gpuLayers, 16);
    assert.equal(est.breakdown.kvVram, est.breakdown.kvRam);
    assert.equal(est.breakdown.weightsVram, 4 * GIB);
  });

  it('uses exact per-role tensor bytes to split weights when the header supplied them', () => {
    // A quarter of the file is embeddings and output, which stay on the CPU until -ngl
    // exceeds the block count.
    const withTensorBytes = geom({ layerBytes: 3, fixedBytes: 1 });
    const est = estimateRunMemory({
      geometry: withTensorBytes,
      weightsBytes: 8 * GIB,
      ctx: 0,
      nGpuLayers: 32,
      backend: 'cuda',
    });
    assert.equal(est.breakdown.weightsVram, 6 * GIB);
    assert.equal(est.breakdown.weightsRam, 2 * GIB);
  });

  it('runs on the CPU at ngl 0', () => {
    const est = estimateRunMemory({ geometry: geom(), weightsBytes: 4 * GIB, ctx: 8192, nGpuLayers: 0 });
    assert.equal(est.vramGb, 0);
    assert.ok(est.ramGb > 4);
  });
});

describe('maxContextForBudget', () => {
  it('solves for context instead of halving until it fits', () => {
    // 128 KiB/token, so 3 GiB of budget holds 24576 tokens — rounded down to 16384.
    assert.equal(maxContextForBudget(geom(), 3 * GIB), 16384);
    assert.equal(maxContextForBudget(geom(), 4 * GIB), 32768);
  });

  it('keeps power-of-two snap by default so Discover display strings stay stable', () => {
    assert.equal(maxContextForBudget(geom(), 3 * GIB, 'f16', { snap: 'power2' }), 16384);
  });

  it('returns the raw token count when snap is none, so non-pot ladder rungs stay reachable', () => {
    // Same 3 GiB / 128 KiB = 24576, which is a CONTEXT_LADDER rung but not a power of two.
    assert.equal(maxContextForBudget(geom(), 3 * GIB, 'f16', { snap: 'none' }), 24576);
  });

  it('reports nothing when even the minimum context does not fit', () => {
    assert.equal(maxContextForBudget(geom(), 0.05 * GIB), 0);
    assert.equal(maxContextForBudget(geom(), -1), 0);
  });
});

describe('weightsBytesFor', () => {
  it('matches published GGUF file sizes within a few percent', () => {
    const cases = [
      [8.03, 'Q4_K_M', 4.58],
      [7.25, 'Q4_K_M', 4.07],
      [70.6, 'Q4_K_M', 39.6],
      [8.03, 'Q8_0', 7.95],
      [8.03, 'Q6_K', 6.15],
    ];
    for (const [paramsB, quant, realGib] of cases) {
      const estimate = weightsBytesFor(paramsB, quant) / GIB;
      const error = Math.abs(estimate - realGib) / realGib;
      assert.ok(error < 0.05, `${paramsB}B ${quant}: ${estimate.toFixed(2)} vs ${realGib}`);
    }
  });
});
