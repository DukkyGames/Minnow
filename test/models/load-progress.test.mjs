/**
 * Modelled load progress.
 *
 * llama.cpp prints no `progress = N %` (verified on b9628). Checkpoints and a
 * row of dots fence a time model. Never goes backwards, never claims 100 before
 * /health, and a 13 GiB first load at 7s must not still read 40%.
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
  parseWeightLoadDots,
  resolveBytesPerMs,
  updateLoadRate,
} from '../../src/models/load-progress.mjs';

const GB = 1024 ** 3;

// ── matchLoadPhase ───────────────────────────────────────────────────────────

describe('matchLoadPhase', () => {
  it('starts at spawning when nothing has been printed', () => {
    assert.equal(matchLoadPhase('').key, 'spawning');
    assert.equal(matchLoadPhase(null).key, 'spawning');
  });

  it('recognises the b9628 Qwen3.8-27B checkpoints in order', () => {
    assert.equal(matchLoadPhase('I srv  llama_server: loading model').key, 'loading');
    assert.equal(
      matchLoadPhase("I srv    load_model: loading model 'E:\\\\Models\\\\qwen.gguf'").key,
      'loading',
    );
    assert.equal(matchLoadPhase('common_init_result: fitting params to device memory ...').key, 'fitting');
    assert.equal(
      matchLoadPhase('llama_model_loader: loaded meta data with 50 key-value pairs').key,
      'header',
    );
    assert.equal(
      matchLoadPhase('load_tensors: loading model tensors, this can take a while... (mmap = true, direct_io = false)').key,
      'weights',
    );
    assert.equal(matchLoadPhase('load_tensors: offloaded 66/66 layers to GPU').key, 'weights');
    assert.equal(matchLoadPhase('llama_context: constructing llama_context').key, 'context');
    assert.equal(matchLoadPhase('llama_kv_cache: size = 5056.00 MiB').key, 'context');
    assert.equal(
      matchLoadPhase('common_init_from_params: warming up the model with an empty run').key,
      'warmup',
    );
    assert.equal(matchLoadPhase('srv    load_model: creating MTP draft context').key, 'warmup');
    assert.equal(matchLoadPhase('clip_model_loader: model name:   Qwen3.8-27B').key, 'warmup');
    assert.equal(matchLoadPhase("srv    load_model: loaded multimodal model, 'mmproj-F16.gguf'").key, 'warmup');
    assert.equal(matchLoadPhase('srv    load_model: initializing slots, n_slots = 1').key, 'warmup');
    assert.equal(
      matchLoadPhase('srv    load_model: speculative decoding context initialized').key,
      'warmup',
    );
    assert.equal(matchLoadPhase('srv  llama_server: model loaded').key, 'listening');
    assert.equal(matchLoadPhase('srv  llama_server: server is listening on http://127.0.0.1:8085').key, 'listening');
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

// ── parseWeightLoadDots ──────────────────────────────────────────────────────

describe('parseWeightLoadDots', () => {
  it('reads the b9628 tensor-copy row and ignores timestamp dots', () => {
    const log = [
      '0.01.726.381 I load_tensors:        CUDA0 model buffer size = 13061.10 MiB',
      `${'.'.repeat(93)}`,
      '0.05.916.328 I llama_context: constructing llama_context',
    ].join('\n');
    assert.equal(parseWeightLoadDots(log), 93);
    assert.equal(parseWeightLoadDots('0.01.726.375 I load_tensors: offloaded 66/66 layers'), null);
    assert.equal(parseWeightLoadDots('this can take a while...'), null);
  });
});

// ── parseSpecContextBytes ────────────────────────────────────────────────────

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

// ── resolveBytesPerMs ────────────────────────────────────────────────────────

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

// ── updateLoadRate ───────────────────────────────────────────────────────────

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

// ── computeLoadProgress ──────────────────────────────────────────────────────

describe('computeLoadProgress', () => {
  const weightsBytes = 10 * GB;
  const bytesPerMs = weightsBytes / 20_000; // a 20-second load — floored at first-load rate
  // Faster than FIRST_LOAD_BYTES_PER_MS so tests that pin remaining time keep this prior.
  const fastBytesPerMs = weightsBytes / 5_000;

  it('sweeps inside the current phase band as time passes', () => {
    const log = 'load_tensors: loading model tensors, this can take a while...';
    const early = computeLoadProgress({
      logText: log,
      elapsedMs: 1_500,
      weightsBytes,
      bytesPerMs: fastBytesPerMs,
    });
    const later = computeLoadProgress({
      logText: log,
      elapsedMs: 3_000,
      weightsBytes,
      bytesPerMs: fastBytesPerMs,
    });
    assert.ok(later.percent > early.percent);
    assert.equal(early.phaseKey, 'weights');
    // Mid-load, still inside the weights band (overtime leak has not started).
    assert.ok(early.percent >= 16 && later.percent <= 82);
  });

  it('never claims 100 until /health, even when a silent phase overruns', () => {
    const stuck = computeLoadProgress({
      logText: 'load_tensors: loading model tensors',
      elapsedMs: 10 * 60_000,
      weightsBytes,
      bytesPerMs,
    });
    assert.equal(stuck.percent, MAX_PERCENT_BEFORE_HEALTHY);
    assert.ok(stuck.percent < 100);
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
    assert.ok(early.percent >= 82);
    assert.ok(later.percent > early.percent);
    assert.ok(later.percent <= 88);
    assert.equal(later.etaMs, null);
    assert.equal(later.modelled, true);
  });

  it('does not sit at 4% through a silent fitting gap', () => {
    // Default verbosity prints "fitting params" then goes quiet for the whole
    // tensor load. Hard-capping at the fitting ceiling (12) rounded back to 4%
    // for most of that gap, then jumped to Ready when /health answered.
    const log = 'common_init_result: fitting params to device memory ...';
    const early = computeLoadProgress({ logText: log, elapsedMs: 1_000 });
    const later = computeLoadProgress({
      logText: log,
      elapsedMs: 12_000,
      previousPercent: early.percent,
      lastElapsedMs: 1_000,
    });
    assert.equal(early.phaseKey, 'fitting');
    assert.ok(later.percent > 12);
    assert.ok(later.percent < 100);
    assert.ok(later.percent > early.percent);
  });

  it('leaks past the spawning ceiling when logs have not advanced', () => {
    const later = computeLoadProgress({
      logText: '',
      elapsedMs: 8_000,
      weightsBytes,
      bytesPerMs,
    });
    assert.equal(later.phaseKey, 'spawning');
    assert.ok(later.percent > 4);
    assert.ok(later.percent < 100);
  });

  it('eases toward a skipped phase floor instead of snapping 8 to 82', () => {
    const fitting = computeLoadProgress({
      logText: 'fitting params to device memory',
      elapsedMs: 2_000,
      previousPercent: 8,
      lastElapsedMs: 1_750,
    });
    const jumped = computeLoadProgress({
      logText: 'llama_context: constructing llama_context',
      elapsedMs: 2_250,
      previousPercent: fitting.percent,
      lastElapsedMs: 2_000,
    });
    assert.equal(jumped.phaseKey, 'context');
    assert.ok(jumped.percent > fitting.percent);
    assert.ok(jumped.percent < 82);
  });

  it('reports the remaining time from the rate prior', () => {
    const result = computeLoadProgress({
      logText: 'load_tensors: loading model tensors',
      elapsedMs: 2_000,
      weightsBytes,
      bytesPerMs: fastBytesPerMs,
    });
    assert.equal(result.etaMs, 3_000);
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
    assert.ok(result.percent >= 16 && result.percent < 82);
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

  it('a stale 20s lastLoadMs does not paint 35% at 7s on a 13 GiB file', () => {
    // Warm mmap of this GGUF is ~7s; a cold prior of 20s is 7/20 = 35%.
    const result = computeLoadProgress({
      logText: 'load_tensors: loading model tensors, this can take a while... (mmap = true)',
      elapsedMs: 7_090,
      weightsBytes: 13.26 * GB,
      bytesPerMs: (13.26 * GB) / 20_000,
    });
    assert.equal(result.phaseKey, 'weights');
    assert.ok(result.percent > 60);
    assert.ok(result.percent < 100);
  });

  it('a 7s load with no file size is well past 35%', () => {
    // Extra-folder path mismatch used to leave weightsBytes at 0, then 7/25 ≈ 28%.
    const result = computeLoadProgress({
      logText: '',
      elapsedMs: 7_090,
    });
    assert.ok(result.percent > 60);
    assert.ok(result.percent < 100);
  });

  it('a 13 GiB first load at 7s is well past 40% from the tensors checkpoint alone', () => {
    // Captured: Qwen3.8-27B IQ4_XS (13.26 GiB) reached /health at 7.09s. With only
    // `loading model tensors` on disk (the copy is silent), a 25s clock painted ~40%.
    const result = computeLoadProgress({
      logText: 'load_tensors: loading model tensors, this can take a while... (mmap = true, direct_io = false)',
      elapsedMs: 7_090,
      weightsBytes: 13.26 * GB,
    });
    assert.equal(result.phaseKey, 'weights');
    assert.ok(result.percent > 60);
    assert.ok(result.percent < 100);
  });

  it('the full b9628 Qwen3.8 checkpoint log reaches listening before /health', () => {
    const log = [
      'I srv  llama_server: loading model',
      'I llama_model_loader: loaded meta data with 50 key-value pairs',
      'I load_tensors: loading model tensors, this can take a while... (mmap = true, direct_io = false)',
      'I load_tensors: offloaded 66/66 layers to GPU',
      `${'.'.repeat(93)}`,
      'I llama_context: constructing llama_context',
      'I llama_kv_cache: size = 5056.00 MiB',
      'I common_init_from_params: warming up the model with an empty run',
      'I srv    load_model: creating MTP draft context against the target model',
      'I clip_model_loader: model name:   Qwen3.8-27B',
      "I srv    load_model: loaded multimodal model, 'mmproj-F16.gguf'",
      'I srv    load_model: initializing slots, n_slots = 1',
      'I srv    load_model: speculative decoding context initialized',
      'I srv  llama_server: model loaded',
      'I srv  llama_server: server is listening on http://127.0.0.1:8085',
    ].join('\n');
    assert.equal(matchLoadPhase(log).key, 'listening');
    const result = computeLoadProgress({
      logText: log,
      elapsedMs: 7_090,
      weightsBytes: 13.26 * GB,
    });
    assert.equal(result.phaseKey, 'listening');
    assert.ok(result.percent >= 96);
    assert.ok(result.percent < 100);
  });
});

// ── mlx-lm load progress ─────────────────────────────────────────────────────

describe('mlx-lm load progress', () => {
  const weightsBytes = 10 * GB;
  const bytesPerMs = weightsBytes / 20_000;
  const fastBytesPerMs = weightsBytes / 5_000;

  it('does not scrape llama phase labels from an empty or unmatched log', () => {
    const empty = computeLoadProgress({
      logText: '',
      elapsedMs: 4_000,
      weightsBytes,
      bytesPerMs,
      runtime: 'mlx-lm',
    });
    assert.equal(empty.phaseKey, 'mlx-weights');
    assert.equal(empty.label, 'Loading weights');
    assert.ok(empty.percent > 0);
    assert.ok(empty.percent < 100);

    const llamaNoise = computeLoadProgress({
      logText: 'srv llama_server: server is listening',
      elapsedMs: 4_000,
      weightsBytes,
      bytesPerMs,
      runtime: 'mlx-lm',
    });
    assert.equal(llamaNoise.phaseKey, 'mlx-weights');
    assert.equal(llamaNoise.label, 'Loading weights');
  });

  it('climbs with a size+rate prior inside the 0–97 band', () => {
    const early = computeLoadProgress({
      logText: '',
      elapsedMs: 1_500,
      weightsBytes,
      bytesPerMs: fastBytesPerMs,
      runtime: 'mlx-lm',
    });
    const later = computeLoadProgress({
      logText: '',
      elapsedMs: 3_000,
      weightsBytes,
      bytesPerMs: fastBytesPerMs,
      previousPercent: early.percent,
      lastElapsedMs: 1_500,
      runtime: 'mlx-lm',
    });
    assert.ok(later.percent > early.percent);
    assert.ok(later.percent <= 97);
  });

  it('stops short of 100 until warmup (healthy) succeeds', () => {
    const loading = computeLoadProgress({
      logText: '',
      elapsedMs: 60_000,
      weightsBytes,
      bytesPerMs,
      runtime: 'mlx-lm',
    });
    assert.equal(loading.percent, MAX_PERCENT_BEFORE_HEALTHY);
    assert.ok(loading.percent < 100);

    const ready = computeLoadProgress({
      elapsedMs: 60_000,
      healthy: true,
      runtime: 'mlx-lm',
    });
    assert.equal(ready.percent, 100);
    assert.equal(ready.phaseKey, 'ready');
  });
});
