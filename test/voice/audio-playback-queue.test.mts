/**
 * Audio playback queue pure logic — PCM conversion and Hann crossfade.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  crossfadePcmChunks,
  hannWindow,
  int16LeToFloat32,
  overlapSamplesForRate,
} from '../../src/voice/audio-playback-queue.ts';

describe('audio-playback-queue', () => {
  test('int16LeToFloat32 decodes little-endian mono samples', () => {
    const bytes = new ArrayBuffer(4);
    const view = new DataView(bytes);
    view.setInt16(0, 16384, true);
    view.setInt16(2, -16384, true);
    const floats = int16LeToFloat32(bytes);
    assert.equal(floats.length, 2);
    assert.ok(Math.abs(floats[0]! - 0.5) < 0.001);
    assert.ok(Math.abs(floats[1]! + 0.5) < 0.001);
  });

  test('hannWindow endpoints are zero-ish and center is one', () => {
    const win = hannWindow(5);
    assert.equal(win.length, 5);
    assert.ok(win[0]! < 0.01);
    assert.ok(win[4]! < 0.01);
    assert.ok(Math.abs(win[2]! - 1) < 0.01);
  });

  test('crossfadePcmChunks merges buffers with overlap length preserved', () => {
    const prev = new Float32Array([0, 0, 1, 0]);
    const next = new Float32Array([0, 1, 1, 0]);
    const merged = crossfadePcmChunks(prev, next, 2);
    assert.equal(merged.length, prev.length + next.length - 2);
    assert.equal(merged[0], 0);
    assert.equal(merged[1], 0);
    assert.equal(merged[4], 1);
    assert.equal(merged[5], 0);
  });

  test('overlapSamplesForRate scales with sample rate', () => {
    assert.equal(overlapSamplesForRate(24_000, 10), 240);
    assert.equal(overlapSamplesForRate(16_000, 10), 160);
  });
});
