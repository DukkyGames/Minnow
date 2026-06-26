import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MINNOW_DEFAULT_PORT } from '../../server/constants/minnow-port.js';

describe('minnow port constants', () => {
  test('client and server defaults stay in sync', async () => {
    const { MINNOW_DEFAULT_PORT: clientPort } = await import('../../src/config/minnow-port.ts');
    assert.equal(clientPort, MINNOW_DEFAULT_PORT);
    assert.notEqual(MINNOW_DEFAULT_PORT, 5173, 'must not use Vite default 5173');
  });
});
