/**
 * withRequestTimeout must clear its timer when the wrapped promise settles.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { withRequestTimeoutForTest } from '../../server/lsp/manager.js';

describe('LSP withRequestTimeout', () => {
  test('clears timer after the wrapped promise resolves', async () => {
    let cleared = false;
    const originalClear = global.clearTimeout;
    global.clearTimeout = (...args) => {
      cleared = true;
      return originalClear(...args);
    };
    try {
      const value = await withRequestTimeoutForTest(Promise.resolve(42), 60_000);
      assert.equal(value, 42);
      assert.equal(cleared, true);
    } finally {
      global.clearTimeout = originalClear;
    }
  });

  test('invokes onTimeout when the budget is exceeded', async () => {
    let cancelled = false;
    await assert.rejects(
      () =>
        withRequestTimeoutForTest(
          new Promise(() => {}),
          30,
          () => {
            cancelled = true;
          },
        ),
      /timed out after 30ms/i,
    );
    assert.equal(cancelled, true);
  });
});
