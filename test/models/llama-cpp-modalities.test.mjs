/**
 * llama-server `/props` is the only place a Minnow-hosted GGUF says whether it
 * loaded a vision projector — `/v1/models` is a bare id list.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  enrichLlamaCppModelsWithModalities,
  visionFromLlamaProps,
} from '../../server/models/llama-cpp-modalities.js';

/** Stand-in for a llama-server that answers `/props` with `payload`. */
function propsFetch(payload, seen = []) {
  return async (url) => {
    seen.push(String(url));
    if (payload === null) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => payload };
  };
}

describe('visionFromLlamaProps', () => {
  it('reads modalities.vision', () => {
    assert.equal(visionFromLlamaProps({ modalities: { vision: true } }), true);
    assert.equal(visionFromLlamaProps({ modalities: { vision: false } }), false);
  });

  it('returns undefined for builds without the field', () => {
    assert.equal(visionFromLlamaProps({ total_slots: 1 }), undefined);
    assert.equal(visionFromLlamaProps({ modalities: {} }), undefined);
    assert.equal(visionFromLlamaProps(null), undefined);
  });
});

describe('enrichLlamaCppModelsWithModalities', () => {
  it('stamps catalogVision on a bare model row', async () => {
    const seen = [];
    const out = await enrichLlamaCppModelsWithModalities(
      'http://127.0.0.1:8080',
      {},
      // A vision-capable model whose name carries no VLM marker at all — the
      // case the old id regex silently got wrong.
      { data: [{ id: 'gemma-3-12b-it', type: 'llm' }] },
      { fetchImpl: propsFetch({ modalities: { vision: true, audio: false } }, seen) },
    );
    assert.equal(out.data[0].catalogVision, true);
    assert.deepEqual(seen, ['http://127.0.0.1:8080/props']);
  });

  it('records the negative when no projector was loaded', async () => {
    const out = await enrichLlamaCppModelsWithModalities(
      'http://127.0.0.1:8080',
      {},
      { data: [{ id: 'qwen3-vl-8b', type: 'llm' }] },
      { fetchImpl: propsFetch({ modalities: { vision: false } }) },
    );
    assert.equal(out.data[0].catalogVision, false);
  });

  it('leaves rows alone when /props is missing', async () => {
    const out = await enrichLlamaCppModelsWithModalities(
      'http://127.0.0.1:8080',
      {},
      { data: [{ id: 'gemma-3-12b-it', type: 'llm' }] },
      { fetchImpl: propsFetch(null) },
    );
    assert.equal(out.data[0].catalogVision, undefined);
  });

  it('leaves rows alone when the server is unreachable', async () => {
    const out = await enrichLlamaCppModelsWithModalities(
      'http://127.0.0.1:8080',
      {},
      { data: [{ id: 'gemma-3-12b-it', type: 'llm' }] },
      {
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    );
    assert.equal(out.data[0].catalogVision, undefined);
  });

  it('never overwrites a flag the catalog already set', async () => {
    const out = await enrichLlamaCppModelsWithModalities(
      'http://127.0.0.1:8080',
      {},
      { data: [{ id: 'known-vlm', type: 'llm', catalogVision: true }] },
      { fetchImpl: propsFetch({ modalities: { vision: false } }) },
    );
    assert.equal(out.data[0].catalogVision, true);
  });

  it('skips the request entirely for an empty list', async () => {
    const seen = [];
    const out = await enrichLlamaCppModelsWithModalities(
      'http://127.0.0.1:8080',
      {},
      { data: [] },
      { fetchImpl: propsFetch({ modalities: { vision: true } }, seen) },
    );
    assert.deepEqual(out.data, []);
    assert.deepEqual(seen, []);
  });
});
