import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GEOMETRY_FAMILIES,
  geometryFromGgufMetadata,
  heuristicLayerCount,
  resolveFamilyKey,
  resolveGeometry,
} from '../../src/models/model-geometry.mjs';

describe('family resolution', () => {
  it('maps HF model_type values onto families', () => {
    assert.equal(resolveFamilyKey({ architecture: 'qwen3_moe' }), 'qwen3_moe');
    assert.equal(resolveFamilyKey({ architecture: 'Qwen2.5' }), 'qwen2');
    assert.equal(resolveFamilyKey({ architecture: 'gemma3_text' }), 'gemma3');
    assert.equal(resolveFamilyKey({ architecture: 'LlamaForCausalLM' }), 'llama');
    assert.equal(resolveFamilyKey({ architecture: 'qwen3_5' }), 'qwen3_5');
    assert.equal(resolveFamilyKey({ architecture: 'qwen35' }), 'qwen3_5');
    assert.equal(resolveFamilyKey({ architecture: 'qwen3_8' }), 'qwen3_5');
  });

  it('falls back to the model name when architecture is missing', () => {
    assert.equal(resolveFamilyKey({ name: 'Qwen3-30B-A3B-Instruct' }), 'qwen3_moe');
    assert.equal(resolveFamilyKey({ name: 'gpt-oss-20b' }), 'gpt_oss');
    assert.equal(resolveFamilyKey({ name: 'something-unheard-of' }), null);
    assert.equal(resolveFamilyKey({ name: 'Qwen/Qwen3.8-27B' }), 'qwen3_5');
    assert.equal(resolveFamilyKey({ name: 'qwen3_8-27b' }), 'qwen3_5');
    assert.equal(resolveFamilyKey({ name: 'qwen3.5-27b' }), 'qwen3_5');
    assert.equal(resolveFamilyKey({ name: 'qwen3.6-27b' }), 'qwen3_5');
  });
});

describe('resolveGeometry', () => {
  it('matches the nearest shipped size on a log scale', () => {
    const qwen8b = resolveGeometry({ architecture: 'qwen3', paramsB: 8.19 });
    assert.equal(qwen8b.source, 'family');
    assert.equal(qwen8b.nLayers, 36);
    assert.equal(qwen8b.nKvHeads, 8);
    assert.equal(qwen8b.headDim, 128);
  });

  it('keeps Llama 2 7B and Llama 3 8B apart despite the shared architecture', () => {
    // Llama 2 is multi-head; Llama 3 is 8-wide GQA. Collapsing them is a 4x KV error.
    assert.equal(resolveGeometry({ architecture: 'llama', paramsB: 6.74 }).nKvHeads, 32);
    assert.equal(resolveGeometry({ architecture: 'llama', paramsB: 8.03 }).nKvHeads, 8);
  });

  it('picks up sliding-window families', () => {
    const gemma = resolveGeometry({ architecture: 'gemma3', paramsB: 12.2 });
    assert.equal(gemma.swaWindow, 1024);
    assert.equal(gemma.swaPeriod, 6);
    const oss = resolveGeometry({ architecture: 'gpt_oss', paramsB: 20.9 });
    assert.equal(oss.swaPeriod, 2);
    assert.equal(oss.nLayers, 24);
  });

  it('uses qwen3_5 hybrid geometry for the 9B and 27B sizes', () => {
    const nine = resolveGeometry({ architecture: 'qwen35', paramsB: 9 });
    assert.equal(nine.source, 'family');
    assert.equal(nine.nLayers, 32);
    assert.equal(nine.nEmbd, 4096);
    assert.equal(nine.swaPeriod, 4);

    const g = resolveGeometry({ architecture: 'qwen3_5', paramsB: 27.78 });
    assert.equal(g.source, 'family');
    assert.equal(g.nLayers, 64);
    assert.equal(g.nKvHeads, 4);
    assert.equal(g.headDim, 256);
    assert.equal(g.nEmbd, 5120);
    assert.equal(g.nVocab, 248320);
    assert.equal(g.swaWindow, 0);
    assert.equal(g.swaPeriod, 4);
  });

  it('falls back to the heuristic when the size is far from any shipped variant', () => {
    const odd = resolveGeometry({ architecture: 'qwen3', paramsB: 120 });
    assert.equal(odd.source, 'heuristic');
    // Family constants still apply — only layers and hidden size are guessed.
    assert.equal(odd.nVocab, GEOMETRY_FAMILIES.qwen3.nVocab);
  });

  it('is heuristic for an unknown architecture but still plausible', () => {
    const unknown = resolveGeometry({ architecture: 'brand_new_arch', paramsB: 8 });
    assert.equal(unknown.source, 'heuristic');
    assert.ok(unknown.nLayers >= 24 && unknown.nLayers <= 48);
    assert.equal(unknown.nKvHeads * unknown.headDim, 1024);
  });

  it('sizes the MoE trunk from active parameters, not the expert bank', () => {
    const moe = resolveGeometry({
      architecture: 'brand_new_moe',
      paramsB: 30,
      activeParamsB: 3,
      nExperts: 128,
    });
    const dense = resolveGeometry({ architecture: 'brand_new_moe', paramsB: 30 });
    assert.ok(moe.nEmbd < dense.nEmbd);
    assert.equal(moe.nExperts, 128);
  });

  it('never returns a degenerate geometry', () => {
    for (const paramsB of [0.05, 0.5, 7, 70, 700]) {
      const g = resolveGeometry({ paramsB });
      assert.ok(g.nLayers > 0 && g.nKvHeads > 0 && g.headDim > 0 && g.nVocab > 0, `${paramsB}B`);
    }
  });

  it('layer heuristic stays monotonic in parameter count', () => {
    let previous = 0;
    for (const p of [0.5, 2, 5, 8, 14, 20, 32, 50, 70, 200]) {
      const layers = heuristicLayerCount(p);
      assert.ok(layers > 0);
      previous = Math.max(previous, layers);
    }
    assert.equal(previous, heuristicLayerCount(200));
  });
});

describe('geometryFromGgufMetadata', () => {
  it('marks header-derived geometry as exact', () => {
    const g = geometryFromGgufMetadata({
      arch: 'llama',
      nLayers: 32,
      nKvHeads: 8,
      headDim: 128,
      nEmbd: 4096,
      nVocab: 128256,
      layerBytes: 4_000_000_000,
      fixedBytes: 500_000_000,
    });
    assert.equal(g.source, 'gguf');
    assert.equal(g.layerBytes, 4_000_000_000);
  });

  it('fills a missing SWA period from the family table', () => {
    const g = geometryFromGgufMetadata({
      arch: 'gemma3',
      nLayers: 48,
      nKvHeads: 8,
      headDim: 256,
      nEmbd: 3840,
      swaWindow: 1024,
      swaPeriod: 0,
    });
    assert.equal(g.swaPeriod, 6);
  });

  it('applies the Qwen3.5 hybrid period when the header omits a sliding window', () => {
    const g = geometryFromGgufMetadata({
      arch: 'qwen35',
      nLayers: 32,
      nKvHeads: 4,
      headDim: 256,
      nEmbd: 4096,
      swaWindow: 0,
      swaPeriod: 0,
    });
    assert.equal(g.swaPeriod, 4);
  });

  it('assumes no windowing when neither the header nor the table knows', () => {
    // Overstating the cache is the safe direction — it never causes a surprise OOM.
    const g = geometryFromGgufMetadata({
      arch: 'unknown_arch',
      nLayers: 40,
      nKvHeads: 8,
      headDim: 128,
      nEmbd: 4096,
      swaWindow: 4096,
      swaPeriod: 0,
    });
    assert.equal(g.swaPeriod, 1);
  });

  it('returns null when the header lacks the fields that matter', () => {
    assert.equal(geometryFromGgufMetadata(null), null);
    assert.equal(geometryFromGgufMetadata({ arch: 'llama', nLayers: 32 }), null);
  });
});
