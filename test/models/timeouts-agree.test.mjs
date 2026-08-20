/**
 * Client and server load-timeout constants must stay equal.
 * Import both modules so a silent drift fails CI instead of hanging one side.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MODEL_LOAD_TIMEOUT_MS as serverMs } from '../../server/models/timeouts.js';
import { MODEL_LOAD_TIMEOUT_MS as clientMs } from '../../src/models/serve-timeouts.ts';

describe('MODEL_LOAD_TIMEOUT_MS parity', () => {
  test('server/models/timeouts.js equals src/models/serve-timeouts.ts', () => {
    assert.equal(serverMs, clientMs);
    assert.equal(serverMs, 180_000);
  });
});
