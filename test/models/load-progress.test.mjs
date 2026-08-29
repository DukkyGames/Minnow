/**
 * Modelled load progress.
 *
 * llama.cpp prints no weight-load percentage (verified on b9628), so the bar is a
 * time model fenced by log phase floors. The properties that matter are that it never
 * goes backwards, never claims 100 before /health, and still climbs inside the current
 * band when no rate prior exists rather than sitting on the phase floor.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeLoadProgress,
  formatLoadPercentLabel,
  LOAD_PHASES,
  MAX_PERCENT_BEFORE_HEALTHY,
  matchLoadPhase,
  parseSpecContextBytes,
  resolveBytesPerMs,
  updateLoadRate,
} from '../../src/models/load-progress.mjs';

const GB = 1024 ** 3;

describe('matchLoadPhase', () => {
  it('starts at spawning when nothing has been printed', () => {
    assert.equal(matchLoadPhase('').key, 'spawning');
    assert.equal(matchLoadPhase(null).key, 'spawning');
  });

  it('recognises the markers b9628 actually prints', () => {
    assert.equal(matchLoadPhase('common_init_result: fitting params to device memory ...').key, 'fitting');
    assert.equal(
      matchLoadPhase('llama_model_loader: loaded meta data with 48 key-value pairs').key,
      'header',
    );
    assert.equal(
      matchLoadPhase('load_tensors: loading model tensors, this can take a while...').key,
      'weights',
    );
    assert.equal(matchLoadPhase('load_tensors: offloaded 34/34 layers to GPU').key, 'offload');
    assert.equal(matchLoadPhase('llama_kv_cache: size =  512.00 MiB').key, 'context');
    assert.equal(
      matchLoadPhase('common_init_from_params: warming up the model with an empty run').key,
      'warmup',
    );
    assert.equal(matchLoadPhase('srv llama_server: server is listening').key, 'listening');
  });

  it('takes the furthest phase reached, not the last line printed', () => {
    const log = [
      'load_tensors: loading model tensors, this can take a while...',
      'srv  llama_server: server is listening on http://127.0.0.1:8085',
      'srv  update_slots: all slots are idle',
    ].join('\n');
    assert.equal(matchLoadPhase(log).key, 'listening');
  });

  it('has bands that only ever move forward', () => {
    for (let i = 1; i < LOAD_PHASES.length; i += 1) {
      assert.ok(
        LOAD_PHASES[i].floor >= LOAD_PHASES[i - 1].ceiling - 1,
        `${LOAD_PHASES[i].key} floor must not sit below the previous ceiling`,
      );
      assert.ok(LOAD_PHASES[i].ceiling > LOAD_PHASES[i].floor);
    }
  });
});

describe('parseSpecContextBytes', () => {
  it('reads the figure llama-server prints for an MTP context', () => {
    // Verbatim from a b9628 load of unsloth/Qwen3.5-9B-MTP-GGUF.
    const log = 'srv    load_model: [spec] estimated memory usage of MTP context is 168.02 MiB';
    assert.equal(parseSpecContextBytes(log), Math.round(168.02 * 1024 ** 2));
  });

  it('handles the other units and finds the line inside a full log', () => {
    const log = [
      'srv  llama_server: loading model',
      'srv    load_model: [spec] estimated memory usage of draft context is 1.50 GiB',
      'srv  llama_server: model loaded',
    ].join('\n');
    assert.equal(parseSpecContextBytes(log), Math.round(1.5 * 1024 ** 3));
  });

  it('reports nothing when spec decoding printed nothing', () => {
    assert.equal(parseSpecContextBytes(''), null);
    assert.equal(parseSpecContextBytes('srv  llama_server: model loaded'), null);
    assert.equal(parseSpecContextBytes(null), null);
  });
});

describe('resolveBytesPerMs', () => {
  it('prefers a prior measured on this exact model', () => {
    const rate = resolveBytesPerMs({
      lastLoadMs: 10_000,
      lastWeightsBytes: 10 * GB,
      variantBytesPerMs: 1,
    });
    assert.equal(rate, (10 * GB) / 10_000);
  });

  it('falls back to the rolling per-variant rate so a first load still has an ETA', () => {
    assert.equal(resolveBytesPerMs({ variantBytesPerMs: 500_000 }), 500_000);
  });

  it('reports nothing usable rather than a garbage rate', () => {
    assert.equal(resolveBytesPerMs({}), 0);
    assert.equal(resolveBytesPerMs({ lastLoadMs: 0, lastWeightsBytes: GB }), 0);
    assert.equal(resolveBytesPerMs({ lastLoadMs: -5, lastWeightsBytes: GB }), 0);
  });
});

describe('updateLoadRate', () => {
  it('seeds from the first sample and then eases toward later ones', () => {
    const first = updateLoadRate(0, { loadMs: 10_000, weightsBytes: 10 * GB });
    assert.equal(first, (10 * GB) / 10_000);

    // A load half as fast pulls the rolling figure down, but not all the way.
    const second = updateLoadRate(first, { loadMs: 20_000, weightsBytes: 10 * GB });
    assert.ok(second < first);
    assert.ok(second > (10 * GB) / 20_000);
  });

  it('keeps the previous value when the sample is unusable', () => {
    const prior = updateLoadRate(0, { loadMs: 10_000, weightsBytes: 10 * GB });
    assert.equal(updateLoadRate(prior, { loadMs: 0, weightsBytes: 10 * GB }), prior);
    assert.equal(updateLoadRate(prior, { loadMs: 100, weightsBytes: 0 }), prior);
    assert.equal(updateLoadRate(0, { loadMs: 0, weightsBytes: 0 }), 0);
  });
});

describe('computeLoadProgress', () => {
  const weightsBytes = 10 * GB;
  const bytesPerMs = weightsBytes / 20_000; // a 20-second load

  it('sweeps inside the current phase band as time passes', () => {
    const log = 'load_tensors: loading model tensors, this can take a while...';
    const early = computeLoadProgress({ logText: log, elapsedMs: 5_000, weightsBytes, bytesPerMs });
    const later = computeLoadProgress({ logText: log, elapsedMs: 10_000, weightsBytes, bytesPerMs });
    assert.ok(later.percent > early.percent);
    assert.equal(early.phaseKey, 'weights');
    // Never outside the band the phase owns, whatever the clock says.
    assert.ok(early.percent >= 18 && later.percent <= 70);
  });

  it('never exceeds the phase ceiling, however long the load drags on', () => {
    const stuck = computeLoadProgress({
      logText: 'load_tensors: loading model tensors',
      elapsedMs: 10 * 60_000,
      weightsBytes,
      bytesPerMs,
    });
    assert.equal(stuck.percent, 70);
    // An overshot model is no longer predicting anything.
    assert.equal(stuck.etaMs, null);
  });

  it('never goes backwards when the phase floor is below what was already shown', () => {
    const result = computeLoadProgress({
      logText: 'load_tensors: loading model tensors',
      elapsedMs: 1_000,
      weightsBytes,
      bytesPerMs,
      previousPercent: 64,
    });
    assert.equal(result.percent, 64);
  });

  it('stops short of 100 until /health answers', () => {
    const listening = computeLoadProgress({
      logText: 'srv llama_server: server is listening',
      elapsedMs: 60_000,
      weightsBytes,
      bytesPerMs,
    });
    assert.equal(listening.percent, MAX_PERCENT_BEFORE_HEALTHY);
    assert.ok(listening.percent < 100);

    const ready = computeLoadProgress({ elapsedMs: 60_000, healthy: true });
    assert.equal(ready.percent, 100);
    assert.equal(ready.phaseKey, 'ready');
  });

  it('climbs inside the current phase band when no rate prior is available', () => {
    const log = 'llama_kv_cache: size = 512.00 MiB';
    const early = computeLoadProgress({
      logText: log,
      elapsedMs: 4_000,
      weightsBytes: 0,
      bytesPerMs: 0,
    });
    const later = computeLoadProgress({
      logText: log,
      elapsedMs: 8_000,
      weightsBytes: 0,
      bytesPerMs: 0,
      previousPercent: early.percent,
      lastElapsedMs: 4_000,
    });
    assert.equal(early.phaseKey, 'context');
    assert.ok(early.percent >= 78);
    assert.ok(later.percent > early.percent);
    assert.ok(later.percent <= 88);
    assert.equal(later.etaMs, null);
    assert.equal(later.modelled, true);
  });

  it('eases toward a skipped phase floor instead of snapping 4 to 70', () => {
    const fitting = computeLoadProgress({
      logText: 'fitting params to device memory',
      elapsedMs: 2_000,
      previousPercent: 4,
      lastElapsedMs: 1_750,
    });
    const jumped = computeLoadProgress({
      logText: 'load_tensors: offloaded 34/34 layers to GPU',
      elapsedMs: 2_250,
      previousPercent: fitting.percent,
      lastElapsedMs: 2_000,
    });
    assert.equal(jumped.phaseKey, 'offload');
    assert.ok(jumped.percent > fitting.percent);
    assert.ok(jumped.percent < 70);
  });

  it('reports the remaining time from the rate prior', () => {
    const result = computeLoadProgress({
      logText: 'load_tensors: loading model tensors',
      elapsedMs: 8_000,
      weightsBytes,
      bytesPerMs,
    });
    assert.equal(result.etaMs, 12_000);
  });

  it('lets a real runtime percentage win over the model', () => {
    const result = computeLoadProgress({
      logText: 'load_tensors: loading model, progress = 42.00 %',
      elapsedMs: 1_000,
      weightsBytes,
      bytesPerMs,
      reportedPercent: 42,
    });
    assert.equal(result.percent, 42);
    assert.equal(result.modelled, false);
  });

  it('does not treat a missing reported percent as 0%', () => {
    // This is the store's real call: parseLoadProgress returns null on llama.cpp.
    const result = computeLoadProgress({
      logText: 'load_tensors: loading model tensors, this can take a while...',
      elapsedMs: 4_000,
      weightsBytes: 0,
      bytesPerMs: 0,
      reportedPercent: null,
    });
    assert.ok(result.percent >= 18 && result.percent < 70);
    assert.equal(result.phaseKey, 'weights');
    assert.equal(result.modelled, true);
  });

  it('still honours a runtime that actually printed 0%', () => {
    const result = computeLoadProgress({
      logText: 'loading 0 %',
      elapsedMs: 4_000,
      reportedPercent: 0,
    });
    assert.equal(result.percent, 0);
    assert.equal(result.modelled, false);
  });

  it('holds a reported percentage monotonic too', () => {
    const result = computeLoadProgress({
      elapsedMs: 1_000,
      reportedPercent: 20,
      previousPercent: 55,
    });
    assert.equal(result.percent, 55);
  });

  it('formatLoadPercentLabel is empty at 0 so the first paint is not stuck', () => {
    assert.equal(formatLoadPercentLabel(0), '');
    assert.equal(formatLoadPercentLabel(null), '');
    assert.equal(formatLoadPercentLabel(37.4), '37%');
  });
});
