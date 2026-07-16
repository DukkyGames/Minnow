/**
 * MIN-408: chats must survive restarts — boot hydration guard + shutdown flush.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { setStorageModeForTests } from '../../src/config/storage-mode.ts';
import { defaultSessionState } from '../../src/config/defaults.ts';
import { putSessionsKeepalive } from '../../src/config/api-client.ts';
import {
  flushPendingSessionSaveOnShutdown,
  isSessionsHydratedFromServerForTests,
  loadSessionsFromStorage,
  resetSessionPersistenceForTests,
  saveSessionsNow,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const SAVED_CHAT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function restoreFetch(): void {
  // @ts-expect-error test cleanup
  delete globalThis.fetch;
}

describe('session persistence (MIN-408)', () => {
  afterEach(() => {
    restoreFetch();
    setStorageModeForTests('localStorage');
    resetSessionPersistenceForTests();
    setSessionStateForTests(null);
  });

  test('server GET failure does not hydrate and blocks PUT clobber', async () => {
    setStorageModeForTests('server');
    resetSessionPersistenceForTests();
    setSessionStateForTests(null);

    globalThis.fetch = async () => {
      throw new Error('config server unavailable');
    };

    await loadSessionsFromStorage();

    assert.ok(sessionState);
    assert.equal(isSessionsHydratedFromServerForTests(), false);

    let putCalled = false;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method === 'PUT') {
        putCalled = true;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    saveSessionsNow();
    assert.equal(putCalled, false);
  });

  test('force reload replaces stale in-memory sessions from ~/.minnow', async () => {
    setStorageModeForTests('server');
    setSessionStateForTests(defaultSessionState());
    resetSessionPersistenceForTests();

    const serverPayload = {
      version: 5,
      activeId: SAVED_CHAT_ID,
      sidebarCollapsed: false,
      chats: [
        {
          id: SAVED_CHAT_ID,
          name: 'Persisted chat',
          workspacePath: '',
          modelId: 'test-model',
          history: [{ role: 'user', content: 'hello' }],
          updatedAt: 1,
        },
      ],
    };

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify(serverPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await loadSessionsFromStorage({ force: true });

    assert.equal(sessionState?.activeId, SAVED_CHAT_ID);
    assert.equal(sessionState?.chats.length, 1);
    assert.equal(sessionState?.chats[0]?.name, 'Persisted chat');
    assert.equal(isSessionsHydratedFromServerForTests(), true);
  });

  test('shutdown flush issues keepalive PUT when hydrated', async () => {
    setStorageModeForTests('server');
    setSessionStateForTests(defaultSessionState());
    resetSessionPersistenceForTests();

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method === 'GET') {
        return new Response(JSON.stringify(defaultSessionState()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await loadSessionsFromStorage({ force: true });

    let keepalive = false;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method === 'PUT') {
        keepalive = init.keepalive === true;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    flushPendingSessionSaveOnShutdown();
    assert.equal(keepalive, true);
  });

  test('putSessionsKeepalive attaches catch to keepalive fetch', () => {
    let catchAttached = false;
    globalThis.fetch = (() => {
      const base = Promise.reject(new TypeError('Failed to fetch')) as Promise<Response>;
      return new Proxy(base, {
        get(target, prop, receiver) {
          if (prop === 'catch') {
            return (...args: Parameters<Promise<Response>['catch']>) => {
              catchAttached = true;
              return Reflect.get(target, prop, receiver).apply(target, args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    }) as typeof fetch;

    putSessionsKeepalive(defaultSessionState());
    assert.equal(catchAttached, true);
  });
});
