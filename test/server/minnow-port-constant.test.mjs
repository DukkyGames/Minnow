import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MINNOW_DEFAULT_PORT } from '../../server/constants/minnow-port.js';

describe('minnow port constants', () => {
  test('client, electron, and server defaults stay in sync', async () => {
    const { MINNOW_DEFAULT_PORT: clientPort } = await import('../../src/config/minnow-port.ts');
    const { MINNOW_DEFAULT_PORT: electronPort } = await import('../../electron/minnow-port.ts');
    assert.equal(clientPort, MINNOW_DEFAULT_PORT);
    assert.equal(electronPort, MINNOW_DEFAULT_PORT);
    assert.notEqual(MINNOW_DEFAULT_PORT, 5173, 'must not use Vite default 5173');
  });

  test('ignores legacy PORT=5173 so workspace Vite can keep it', async () => {
    const { resolveMinnowPort, MINNOW_DEFAULT_PORT } = await import(
      '../../server/constants/minnow-port.js'
    );
    assert.equal(resolveMinnowPort({ PORT: '5173' }), MINNOW_DEFAULT_PORT);
    assert.equal(resolveMinnowPort({ MINNOW_PORT: '9480' }), 9480);
  });
});
