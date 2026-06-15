/**
 * Silence detector unit tests — level readout and speech threshold.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_SPEECH_THRESHOLD,
  readAudioLevel,
} from '../../src/voice/silence-detector.ts';

describe('silence detector', () => {
  test('readAudioLevel averages frequency bins', () => {
    const bins = new Uint8Array([10, 20, 30, 40]);
    const analyser = {
      frequencyBinCount: bins.length,
      getByteFrequencyData(target: Uint8Array) {
        target.set(bins);
      },
    } as AnalyserNode;

    assert.equal(readAudioLevel(analyser), 25);
  });

  test('DEFAULT_SPEECH_THRESHOLD matches composer mic detecting gate', () => {
    assert.equal(DEFAULT_SPEECH_THRESHOLD, 5);
  });
});
