/**
 * Session SSE reconnect after a server restart refreshes the per-boot token
 * (parity with install-fetch-auth). Unchanged tokens must not reconnect-loop.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

/** @type {Window | null} */
let activeWindow = null;
/** @type {typeof EventSource | undefined} */
let prevEventSource;
/** @type {string[]} */
let constructedUrls = [];
/** @type {Array<{ url: string, readyState: number, onerror: ((ev?: unknown) => void) | null, close: () => void, addEventListener: () => void }>} */
let fakeSources = [];

function installFakeEventSource() {
  constructedUrls = [];
  fakeSources = [];
  prevEventSource = globalThis.EventSource;

  class FakeEventSource {
    /** @param {string} url */
    constructor(url) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.onerror = null;
      constructedUrls.push(url);
      fakeSources.push(this);
      // Become OPEN on next tick (healthy stream).
      queueMicrotask(() => {
        if (this.readyState !== 2) this.readyState = 1;
      });
    }

    addEventListener() {
      /* snapshot/patch unused in this suite */
    }

    close() {
      this.readyState = 2; // CLOSED
    }
  }

  FakeEventSource.CONNECTING = 0;
  FakeEventSource.OPEN = 1;
  FakeEventSource.CLOSED = 2;
  globalThis.EventSource = /** @type {typeof EventSource} */ (FakeEventSource);
}

function setupBrowserGlobals(token = 'token-old') {
  activeWindow?.close();
  const window = new Window();
  activeWindow = window;
  globalThis.window = /** @type {any} */ (window);
  globalThis.document = window.document;
  window.__MINNOW_SESSION_TOKEN__ = token;
}

afterEach(async () => {
  const { resetSessionSyncForTests } = await import('../../src/state/session-sync.ts');
  resetSessionSyncForTests();
  const { setStorageModeForTests } = await import('../../src/config/storage-mode.ts');
  setStorageModeForTests('localStorage');
  if (prevEventSource) globalThis.EventSource = prevEventSource;
  activeWindow?.close();
  activeWindow = null;
  // @ts-expect-error cleanup
  delete globalThis.window;
});

describe('session-sync SSE token refresh reconnect', () => {
  beforeEach(() => {
    installFakeEventSource();
    setupBrowserGlobals('token-old');
  });

  test('CLOSED stream with a new token opens a second EventSource URL', async () => {
    const { setStorageModeForTests } = await import('../../src/config/storage-mode.ts');
    setStorageModeForTests('server');

    // First refresh returns a new boot token (server restarted).
    const nativeFetch = async (input) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/api/auth/session-token')) {
        return new Response(JSON.stringify({ token: 'token-new' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    globalThis.fetch = /** @type {typeof fetch} */ (nativeFetch);

    const { initSessionSync, resetSessionSyncForTests } = await import(
      '../../src/state/session-sync.ts'
    );
    resetSessionSyncForTests();
    initSessionSync();

    assert.equal(constructedUrls.length, 1);
    assert.match(constructedUrls[0], /token=token-old/);

    // Simulate EventSource giving up after auth failure (CLOSED).
    const first = fakeSources[0];
    first.readyState = 2;
    first.onerror?.(new Event('error'));

    // Backoff is 250ms for the first reconnect.
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(constructedUrls.length, 2, 'expected a second EventSource after token refresh');
    assert.match(constructedUrls[1], /token=token-new/);
  });

  test('CLOSED stream with an unchanged token does not reconnect-loop', async () => {
    const { setStorageModeForTests } = await import('../../src/config/storage-mode.ts');
    setStorageModeForTests('server');

    const nativeFetch = async (input) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/api/auth/session-token')) {
        return new Response(JSON.stringify({ token: 'token-old' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    globalThis.fetch = /** @type {typeof fetch} */ (nativeFetch);

    const { initSessionSync, resetSessionSyncForTests } = await import(
      '../../src/state/session-sync.ts'
    );
    resetSessionSyncForTests();
    initSessionSync();
    assert.equal(constructedUrls.length, 1);

    const first = fakeSources[0];
    first.readyState = 2;
    first.onerror?.(new Event('error'));

    await new Promise((r) => setTimeout(r, 400));
    assert.equal(constructedUrls.length, 1, 'unchanged token must not open another EventSource');

    // Fire onerror again — still must not spin.
    first.onerror?.(new Event('error'));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(constructedUrls.length, 1);
  });
});
