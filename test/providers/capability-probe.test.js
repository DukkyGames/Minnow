/**
 * capability-probe unit tests (no HTTP — integration lives in capability-probe-server.test.js).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVisionProbe,
  isVisionProbeRuntimeCrash,
  prioritizeModelIds,
  providerDecodesVisionLocally,
  shouldSendCorruptImageVisionControl,
  shouldSkipAutoVisionCapabilityProbe,
} from '../../server/providers/capability-probe.js';

describe('prioritizeModelIds', () => {
  it('orders selected, loaded, then alphabetical and caps at 8', () => {
    const ids = [
      'm-h',
      'm-b',
      'm-a',
      'm-c',
      'm-d',
      'm-e',
      'm-f',
      'm-g',
      'm-i',
      'm-selected',
    ];
    const catalog = [
      { id: 'm-b', state: 'loaded' },
      { id: 'm-a', state: 'not loaded' },
    ];
    const out = prioritizeModelIds(ids, 'm-selected', catalog);
    assert.equal(out[0], 'm-selected');
    assert.equal(out[1], 'm-b');
    assert.equal(out.length, 8);
    assert.ok(out.includes('m-a'));
  });
});

describe('loopback vision probe gates (MIN-839)', () => {
  it('treats llama-cpp-local, mlx-lm-local, and loopback URLs as local decoders', () => {
    assert.equal(providerDecodesVisionLocally({ id: 'llama-cpp-local', baseUrl: 'http://example.com' }), true);
    assert.equal(providerDecodesVisionLocally({ id: 'mlx-lm-local', baseUrl: 'https://api.openai.com' }), true);
    assert.equal(
      providerDecodesVisionLocally({ id: 'custom-llama', baseUrl: 'http://127.0.0.1:8081' }),
      true,
    );
    assert.equal(
      providerDecodesVisionLocally({ id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' }),
      false,
    );
  });

  it('skips the corrupt-image control on loopback and keeps it for remote gateways', () => {
    assert.equal(
      shouldSendCorruptImageVisionControl({ id: 'custom', baseUrl: 'http://127.0.0.1:8081' }),
      false,
    );
    assert.equal(
      shouldSendCorruptImageVisionControl({ id: 'llama-cpp-local', baseUrl: 'http://127.0.0.1:8080' }),
      false,
    );
    assert.equal(
      shouldSendCorruptImageVisionControl({ id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' }),
      true,
    );
  });

  it('skips auto vision on loopback openai-v1 but not on LM Studio', () => {
    assert.equal(
      shouldSkipAutoVisionCapabilityProbe({
        id: 'custom',
        baseUrl: 'http://127.0.0.1:8081',
        apiKind: 'openai-v1',
      }),
      true,
    );
    assert.equal(
      shouldSkipAutoVisionCapabilityProbe({
        id: 'llama-cpp-local',
        baseUrl: 'http://127.0.0.1:8080',
        apiKind: 'openai-v1',
      }),
      true,
    );
    assert.equal(
      shouldSkipAutoVisionCapabilityProbe({
        id: 'lm-studio-local',
        baseUrl: 'http://127.0.0.1:1234',
        apiKind: 'lm-studio-v0',
      }),
      false,
    );
    assert.equal(
      shouldSkipAutoVisionCapabilityProbe({
        id: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKind: 'openai-v1',
      }),
      false,
    );
  });

  it('detects mtmd / ffprobe / CUDA as a runtime crash', () => {
    assert.equal(
      isVisionProbeRuntimeCrash({
        ok: false,
        status: 500,
        text: 'E mtmd_helper_video_init_from_buf: ffprobe failed on buffer',
      }),
      true,
    );
    assert.equal(
      isVisionProbeRuntimeCrash({
        ok: false,
        status: 500,
        text: 'failed to decode buffer as either image/audio/video',
      }),
      true,
    );
    assert.equal(
      isVisionProbeRuntimeCrash({
        ok: false,
        status: 500,
        text: 'ggml-cuda.cu:108: CUDA error',
      }),
      true,
    );
    assert.equal(
      isVisionProbeRuntimeCrash({ ok: false, status: 0, text: 'fetch failed', networkError: true }),
      true,
    );
    assert.equal(
      isVisionProbeRuntimeCrash({
        ok: false,
        status: 400,
        text: 'model does not support images',
      }),
      false,
    );
  });

  it('does not stamp probe-sourced vision from a crash, and does from a clean reject', () => {
    const crashed = {
      vision: false,
      sources: { vision: 'catalog' },
      probeErrors: {},
    };
    applyVisionProbe(crashed, {
      ok: false,
      status: 500,
      text: 'E mtmd_helper_bitmap_init_from_buf: failed to decode buffer as either image/audio/video',
    });
    assert.equal(crashed.sources.vision, 'catalog');
    assert.notEqual(crashed.vision, true);
    assert.match(crashed.probeErrors.vision, /mtmd|decode buffer/i);

    const rejected = {
      vision: false,
      sources: { vision: 'catalog' },
      probeErrors: {},
    };
    applyVisionProbe(rejected, { ok: false, status: 400, text: 'model does not support images' });
    assert.equal(rejected.vision, false);
    assert.equal(rejected.sources.vision, 'probe');

    const ok = {
      vision: false,
      sources: { vision: 'catalog' },
      probeErrors: {},
    };
    applyVisionProbe(ok, { ok: true, status: 200 });
    assert.equal(ok.vision, true);
    assert.equal(ok.sources.vision, 'probe');

    const passthrough = {
      vision: false,
      sources: { vision: 'catalog' },
      probeErrors: {},
    };
    applyVisionProbe(passthrough, { ok: true, status: 200 }, { ok: true, status: 200 });
    assert.notEqual(passthrough.vision, true);
    assert.notEqual(passthrough.sources.vision, 'probe');
    assert.match(passthrough.probeErrors.vision, /corrupt image/i);
  });
});
