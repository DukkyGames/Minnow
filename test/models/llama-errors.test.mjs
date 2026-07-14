/**
 * Friendly llama.cpp error mapping.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mapLlamaError } from '../../server/models/llama-errors.js';

describe('mapLlamaError', () => {
  test('maps CUDA OOM to actionable message', () => {
    const msg = mapLlamaError('CUDA error: out of memory');
    assert.match(msg, /out of memory/i);
  });

  test('maps driver mismatch', () => {
    const msg = mapLlamaError('CUDA driver version is insufficient for CUDA runtime version');
    assert.match(msg, /driver mismatch/i);
  });

  test('maps router mode requirement', () => {
    const msg = mapLlamaError('does not support router mode');
    assert.match(msg, /update the runtime/i);
  });
});
