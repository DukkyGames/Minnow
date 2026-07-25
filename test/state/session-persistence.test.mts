/**
 * MIN-408 + B.2: hydration guard, PATCH flush, shutdown beacon size branch.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { setStorageModeForTests } from '../../src/config/storage-mode.ts';
import { defaultSessionState } from '../../src/config/defaults.ts';
import {
  chooseSessionsShutdownTransport,
  FETCH_KEEPALIVE_MAX_BYTES,
  putSessionsKeepalive,
  SESSIONS_BEACON_MAX_BYTES,
} from '../../src/config/api-client.ts';
import {
  buildSessionsPatchDelta,
  flushPendingSessionSaveOnShutdown,
  getSessionDirtyTrackingForTests,
  isSessionsHydratedFromServerForTests,
  loadSessionsFromStorage,
  markGroupDeleted,
  markGroupDirty,
  resetSessionPersistenceForTests,
  saveSessionsNow,
  sessionState,
  setSessionPatchDirtySetsReadyForTests,
  setSessionStateForTests,
  setSessionsClientPatchEnabledForTests,
  touchChat,
  waitForSessionSaveForTests,
} from '../../src/state/sessions.ts';
import type { ChatGroup, SessionState } from '../../src/types.ts';

const SAVED_CHAT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GROUP_ID = 'grp_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function restoreFetch(): void {
  // @ts-expect-error test cleanup
  delete globalThis.fetch;
}

describe('session persistence (MIN-408 + B.2)', () => {
  afterEach(() => {
    restoreFetch();
    // @ts-expect-error test cleanup
    delete globalThis.navigator;
    setStorageModeForTests('localStorage');
    resetSessionPersistenceForTests();
    setSessionStateForTests(null);
  });

  test('server GET failure does not hydrate and blocks PATCH/PUT clobber', async () => {
    setStorageModeForTests('server');
    resetSessionPersistenceForTests();
    setSessionStateForTests(null);

    globalThis.fetch = async () => {
      throw new Error('config server unavailable');
    };

    await loadSessionsFromStorage();

    assert.ok(sessionState);
    assert.equal(isSessionsHydratedFromServerForTests(), false);

    let writeCalled = false;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (
        url.includes('/api/config/sessions') &&
        (init?.method === 'PUT' || init?.method === 'PATCH' || init?.method === 'POST')
      ) {
        writeCalled = true;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    // Dirty markers must not bypass the MIN-408 hydration guard.
    if (sessionState?.chats[0]) touchChat(sessionState.chats[0]);
    setSessionPatchDirtySetsReadyForTests(true);
    assert.ok(getSessionDirtyTrackingForTests().dirtyChatIds.length >= 1);
    saveSessionsNow();
    await waitForSessionSaveForTests();
    assert.equal(writeCalled, false);
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
    assert.equal(getSessionDirtyTrackingForTests().sessionPatchDirtySetsReady, false);
  });

  test('first save after load uses full PUT then subsequent saves PATCH', async () => {
    setStorageModeForTests('server');
    setSessionStateForTests(defaultSessionState());
    resetSessionPersistenceForTests();

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify(defaultSessionState()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await loadSessionsFromStorage({ force: true });
    assert.equal(getSessionDirtyTrackingForTests().sessionPatchDirtySetsReady, false);

    const methods: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method) {
        methods.push(init.method);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    if (sessionState?.chats[0]) touchChat(sessionState.chats[0]);
    saveSessionsNow();
    await waitForSessionSaveForTests();
    assert.deepEqual(methods, ['PUT']);
    assert.equal(getSessionDirtyTrackingForTests().sessionPatchDirtySetsReady, true);

    methods.length = 0;
    if (sessionState?.chats[0]) touchChat(sessionState.chats[0]);
    saveSessionsNow();
    await waitForSessionSaveForTests();
    assert.deepEqual(methods, ['PATCH']);
  });

  test('failed PATCH keeps dirty sets for retry', async () => {
    setStorageModeForTests('server');
    const state = defaultSessionState();
    setSessionStateForTests(state);

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 });

    touchChat(state.chats[0]!);
    saveSessionsNow();
    await waitForSessionSaveForTests();

    assert.deepEqual(getSessionDirtyTrackingForTests().dirtyChatIds, [state.chats[0]!.id]);
  });

  test('deletedGroupIds are emitted on PATCH (not dirty upsert)', async () => {
    setStorageModeForTests('server');
    const state = defaultSessionState();
    const group: ChatGroup = {
      id: GROUP_ID,
      name: 'Folder',
      workspacePath: '',
      collapsed: false,
      order: 0,
      createdAt: 1,
    };
    state.groups = [group];
    setSessionStateForTests(state);

    let patchBody: unknown = null;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method === 'PATCH') {
        patchBody = JSON.parse(String(init.body));
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    // Simulate delete: mark deleted (and ensure a prior dirty mark is superseded).
    markGroupDirty(GROUP_ID);
    state.groups = [];
    markGroupDeleted(GROUP_ID);
    saveSessionsNow();
    await waitForSessionSaveForTests();

    const body = patchBody as { deleteGroupIds?: string[]; groups?: ChatGroup[] };
    assert.deepEqual(body.deleteGroupIds, [GROUP_ID]);
    assert.equal(body.groups, undefined);
  });

  test('buildSessionsPatchDelta includes only dirty chats', () => {
    const state = defaultSessionState() as SessionState;
    state.chats = [
      {
        id: SAVED_CHAT_ID,
        name: 'A',
        workspacePath: '',
        modelId: 'm',
        modeId: 'build',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
        lastMessageAt: 1,
      },
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        name: 'B',
        workspacePath: '',
        modelId: 'm',
        modeId: 'build',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
        lastMessageAt: 1,
      },
    ];
    setSessionStateForTests(state);
    touchChat(state.chats[0]!);
    const delta = buildSessionsPatchDelta(state);
    assert.equal(delta.chats?.length, 1);
    assert.equal(delta.chats?.[0]?.id, SAVED_CHAT_ID);
  });

  test('chooseSessionsShutdownTransport respects 60 KiB beacon threshold', () => {
    assert.equal(chooseSessionsShutdownTransport(SESSIONS_BEACON_MAX_BYTES - 1), 'beacon');
    assert.equal(chooseSessionsShutdownTransport(SESSIONS_BEACON_MAX_BYTES), 'keepalive-put');
    assert.equal(chooseSessionsShutdownTransport(FETCH_KEEPALIVE_MAX_BYTES), 'keepalive-put');
  });

  test('shutdown flush uses sendBeacon for small PATCH deltas', async () => {
    setStorageModeForTests('server');
    setSessionStateForTests(defaultSessionState());
    resetSessionPersistenceForTests();

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify(defaultSessionState()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await loadSessionsFromStorage({ force: true });
    // Establish trusted dirty sets via a baseline PUT.
    if (sessionState?.chats[0]) touchChat(sessionState.chats[0]);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 });
    saveSessionsNow();
    await waitForSessionSaveForTests();

    let beaconBodies: string[] = [];
    let keepalivePut = false;
    // @ts-expect-error test stub
    globalThis.navigator = {
      sendBeacon(url: string, data?: BodyInit | null) {
        assert.equal(url, '/api/config/sessions');
        if (data instanceof Blob) {
          // Blob.text is async; decode via FileReader-less path for Node.
          beaconBodies.push('queued');
        } else {
          beaconBodies.push(String(data ?? ''));
        }
        return true;
      },
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method === 'PUT' && init.keepalive) {
        keepalivePut = true;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    if (sessionState?.chats[0]) touchChat(sessionState.chats[0]);
    flushPendingSessionSaveOnShutdown();
    assert.equal(beaconBodies.length, 1);
    assert.equal(keepalivePut, false);
  });

  test('shutdown flush falls back to keepalive PUT when delta is oversized', async () => {
    setStorageModeForTests('server');
    const state = defaultSessionState();
    // Inflate one chat so the PATCH delta exceeds the 60 KiB beacon budget.
    state.chats[0]!.history = [
      { role: 'user', content: 'x'.repeat(SESSIONS_BEACON_MAX_BYTES) },
    ];
    setSessionStateForTests(state);

    let beaconCalls = 0;
    let keepalivePut = false;
    // @ts-expect-error test stub
    globalThis.navigator = {
      sendBeacon() {
        beaconCalls += 1;
        return true;
      },
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method === 'PUT' && init.keepalive) {
        keepalivePut = true;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    touchChat(state.chats[0]!);
    flushPendingSessionSaveOnShutdown();
    assert.equal(beaconCalls, 0);
    assert.equal(keepalivePut, true);
  });

  test('sessionsClientPatchEnabled=false forces full PUT', async () => {
    setStorageModeForTests('server');
    const state = defaultSessionState();
    setSessionStateForTests(state);
    setSessionsClientPatchEnabledForTests(false);

    let method = '';
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method) {
        method = init.method;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    touchChat(state.chats[0]!);
    saveSessionsNow();
    await waitForSessionSaveForTests();
    assert.equal(method, 'PUT');
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
