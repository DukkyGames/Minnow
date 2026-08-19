/**
 * Live runtime detail for a local llama.cpp stream.
 *
 * The percentage here is real — `prompt_progress.total` is present from the first
 * chunk. That is the difference between this surface and the Loaded Models card, which
 * can only show a token count because `/slots` has no total.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { llamaRuntimeStatusView } from '../../src/chat/llama-runtime-status.ts';

describe('llamaRuntimeStatusView', () => {
  it('says nothing for a provider that reports neither', () => {
    assert.deepEqual(llamaRuntimeStatusView(undefined, false), { phase: null, detail: '' });
    assert.deepEqual(llamaRuntimeStatusView({}, false), { phase: null, detail: '' });
  });

  it('reports a real prefill percentage while the prompt is being processed', () => {
    const view = llamaRuntimeStatusView(
      { prompt_progress: { total: 16360, cache: 0, processed: 8192, time_ms: 1047 } },
      false,
    );
    assert.equal(view.phase, 'prompt_processing');
    assert.equal(view.detail, '50%');
  });

  it('never shows 100% for prefill — that belongs to the first token', () => {
    const view = llamaRuntimeStatusView(
      { prompt_progress: { total: 10000, cache: 0, processed: 9999, time_ms: 10 } },
      false,
    );
    assert.equal(view.detail, '99%');
  });

  it('explains a cached prefix instead of looking stuck near full', () => {
    const view = llamaRuntimeStatusView(
      { prompt_progress: { total: 10020, cache: 10016, processed: 10016, time_ms: 12 } },
      false,
    );
    assert.equal(view.phase, 'prompt_processing');
    assert.equal(view.detail, '10,016 of 10,020 cached');
  });

  it('switches to a token count once generation starts', () => {
    const view = llamaRuntimeStatusView(
      {
        prompt_progress: { total: 16360, cache: 0, processed: 16360, time_ms: 2214 },
        timings: { predicted_n: 917 },
      },
      true,
    );
    assert.equal(view.phase, 'generating');
    assert.equal(view.detail, '917 tokens');
  });

  it('does not fall back to prefill once output has been shown', () => {
    // The last prompt_progress chunk can still say "incomplete" when a token has
    // already been rendered; the visible stream wins.
    const view = llamaRuntimeStatusView(
      {
        prompt_progress: { total: 16360, cache: 0, processed: 8192, time_ms: 1047 },
        timings: { predicted_n: 3 },
      },
      true,
    );
    assert.equal(view.phase, 'generating');
    assert.equal(view.detail, '3 tokens');
  });

  it('gets the singular right', () => {
    assert.equal(llamaRuntimeStatusView({ timings: { predicted_n: 1 } }, true).detail, '1 token');
  });
});
