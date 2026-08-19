/**
 * `/slots` normalisation.
 *
 * Every quirk locked here was measured against llama-server b9628, not assumed:
 * idle slots carry four fields; `n_prompt_tokens` mirrors the running processed count
 * during prefill (so there is no denominator to make a percentage from); `n_decoded`
 * is stale from the previous task until the new one has tokens left to produce; and a
 * saturated server simply stops answering.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import {
  getServeActivity,
  listServeActivity,
  normalizeSlots,
  resetServeActivityFetchForTests,
  setServeActivityFetchForTests,
  startServeActivity,
  stopAllServeActivity,
  subscribeServeActivity,
} from '../../server/models/serve-activity.js';

after(() => {
  stopAllServeActivity();
  resetServeActivityFetchForTests();
});

/** Wait for the poller to publish, without a fixed sleep. */
function nextActivity(timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('no activity sample published'));
    }, timeoutMs);
    const unsubscribe = subscribeServeActivity((activity) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(activity);
    });
  });
}

describe('normalizeSlots', () => {
  it('reads an idle slot from the four fields llama.cpp sends', () => {
    const slots = normalizeSlots(
      [{ id: 0, n_ctx: 16384, speculative: false, is_processing: false }],
      new Map(),
      1_000,
    );
    assert.deepEqual(slots, [
      {
        id: 0,
        taskId: null,
        state: 'idle',
        promptProcessed: 0,
        promptCached: 0,
        decoded: 0,
        remaining: null,
        tokensPerSecond: null,
      },
    ]);
  });

  it('reports prefill as a token count, because /slots has no total to divide by', () => {
    const slots = normalizeSlots(
      [
        {
          id: 0,
          is_processing: true,
          id_task: 1305,
          // During prefill these two are the same running count, not a part and a whole.
          n_prompt_tokens: 10240,
          n_prompt_tokens_processed: 10240,
          n_prompt_tokens_cache: 0,
          next_token: [{ n_remain: 0, n_decoded: 60 }],
        },
      ],
      new Map(),
      1_000,
    );
    assert.equal(slots[0].state, 'prompt');
    assert.equal(slots[0].promptProcessed, 10240);
    // n_decoded here is left over from the previous task — it must not be shown.
    assert.equal(slots[0].decoded, 0);
    assert.equal(slots[0].remaining, null);
  });

  it('surfaces the cached prefix so a near-instant prefill is explainable', () => {
    const slots = normalizeSlots(
      [
        {
          id: 0,
          is_processing: true,
          id_task: 7,
          n_prompt_tokens_processed: 10016,
          n_prompt_tokens_cache: 10016,
          next_token: [{ n_remain: 0, n_decoded: 0 }],
        },
      ],
      new Map(),
      1_000,
    );
    assert.equal(slots[0].promptCached, 10016);
  });

  it('switches to generating once the task has tokens left to produce', () => {
    const slots = normalizeSlots(
      [
        {
          id: 0,
          is_processing: true,
          id_task: 1305,
          n_prompt_tokens_processed: 16360,
          next_token: [{ n_remain: 295, n_decoded: 5 }],
        },
      ],
      new Map(),
      1_000,
    );
    assert.equal(slots[0].state, 'generating');
    assert.equal(slots[0].decoded, 5);
    assert.equal(slots[0].remaining, 295);
  });

  it('derives tok/s from consecutive samples of the same task', () => {
    const prev = new Map();
    normalizeSlots(
      [{ id: 0, is_processing: true, id_task: 1, next_token: [{ n_remain: 100, n_decoded: 10 }] }],
      prev,
      1_000,
    );
    const second = normalizeSlots(
      [{ id: 0, is_processing: true, id_task: 1, next_token: [{ n_remain: 60, n_decoded: 50 }] }],
      prev,
      2_000,
    );
    // 40 tokens in 1000 ms.
    assert.equal(second[0].tokensPerSecond, 40);
  });

  it('does not carry a rate across a task change', () => {
    const prev = new Map();
    normalizeSlots(
      [{ id: 0, is_processing: true, id_task: 1, next_token: [{ n_remain: 10, n_decoded: 900 }] }],
      prev,
      1_000,
    );
    const second = normalizeSlots(
      [{ id: 0, is_processing: true, id_task: 2, next_token: [{ n_remain: 100, n_decoded: 3 }] }],
      prev,
      2_000,
    );
    assert.equal(second[0].tokensPerSecond, null);
    assert.equal(second[0].decoded, 3);
  });

  it('ignores a body that is not a slot array', () => {
    assert.deepEqual(normalizeSlots(null, new Map(), 0), []);
    assert.deepEqual(normalizeSlots({ error: 'slots disabled' }, new Map(), 0), []);
  });
});

describe('the /slots poller', () => {
  it('publishes a normalised sample for a running serve', async () => {
    stopAllServeActivity();
    setServeActivityFetchForTests(async () => ({
      ok: true,
      json: async () => [
        {
          id: 0,
          is_processing: true,
          id_task: 42,
          n_prompt_tokens_processed: 2048,
          next_token: [{ n_remain: 0, n_decoded: 0 }],
        },
      ],
    }));

    startServeActivity({ id: 'serve-a', baseUrl: 'http://127.0.0.1:9999', runtime: 'llama-cpp' });
    const activity = await nextActivity();
    assert.equal(activity.serveId, 'serve-a');
    assert.equal(activity.available, true);
    assert.equal(activity.stale, false);
    assert.equal(activity.slots[0].state, 'prompt');
    assert.equal(activity.slots[0].promptProcessed, 2048);
    stopAllServeActivity();
  });

  it('marks a serve stale instead of idle when /slots stops answering', async () => {
    stopAllServeActivity();
    setServeActivityFetchForTests(async () => {
      throw new Error('timeout');
    });

    startServeActivity({ id: 'serve-b', baseUrl: 'http://127.0.0.1:9999', runtime: 'llama-cpp' });
    const activity = await nextActivity();
    assert.equal(activity.available, false);
    assert.equal(activity.stale, true);
    // Crucially not an empty "Ready" — a saturated server must not read as idle.
    assert.deepEqual(activity.slots, []);
    stopAllServeActivity();
  });

  it('keeps the last good sample when a later poll fails', async () => {
    stopAllServeActivity();
    let calls = 0;
    setServeActivityFetchForTests(async () => {
      calls += 1;
      if (calls > 1) throw new Error('busy');
      return {
        ok: true,
        json: async () => [
          { id: 0, is_processing: true, id_task: 5, next_token: [{ n_remain: 50, n_decoded: 12 }] },
        ],
      };
    });

    startServeActivity({ id: 'serve-c', baseUrl: 'http://127.0.0.1:9999', runtime: 'llama-cpp' });
    await nextActivity();
    const afterFailure = await nextActivity(3_000);
    assert.equal(afterFailure.stale, true);
    assert.equal(afterFailure.slots[0].decoded, 12, 'last good sample is kept, not discarded');
    stopAllServeActivity();
  });

  it('does not poll a non-llama.cpp serve', () => {
    stopAllServeActivity();
    startServeActivity({ id: 'serve-mlx', baseUrl: 'http://127.0.0.1:9999', runtime: 'mlx-lm' });
    assert.equal(getServeActivity('serve-mlx'), null);
    assert.deepEqual(listServeActivity(), []);
  });
});
