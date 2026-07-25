/**
 * Phase B.1: dirty-tracking telemetry (touchChat / dirty sets / DEV verifier).
 * Persistence protocol is unchanged — flush still PUTs the whole SessionState blob.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { setStorageModeForTests } from '../../src/config/storage-mode.ts';
import { defaultSessionState } from '../../src/config/defaults.ts';
import {
  captureDirtyTrackingShadowForTests,
  getSessionDirtyTrackingForTests,
  removeChatById,
  resetSessionPersistenceForTests,
  saveSessionsNow,
  setDirtyTrackingVerifierForcedForTests,
  setSessionStateForTests,
  setSidebarCollapsed,
  touchChat,
} from '../../src/state/sessions.ts';
import type { Chat, SessionState } from '../../src/types.ts';

const CHAT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CHAT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function baseState(): SessionState {
  const state = defaultSessionState();
  state.chats = [
    {
      id: CHAT_A,
      name: 'Chat A',
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
      id: CHAT_B,
      name: 'Chat B',
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
  state.activeId = CHAT_A;
  return state;
}

describe('session dirty tracking (B.1)', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
    setStorageModeForTests('localStorage');
    resetSessionPersistenceForTests();
    setSessionStateForTests(null);
  });

  test('touchChat marks dirtyChatIds', () => {
    const state = baseState();
    setSessionStateForTests(state);
    const chat = state.chats[0] as Chat;
    touchChat(chat);
    const dirty = getSessionDirtyTrackingForTests();
    assert.deepEqual(dirty.dirtyChatIds, [CHAT_A]);
    assert.equal(dirty.sessionScalarsDirty, false);
  });

  test('flush clears dirty sets even though PUT is still whole-blob', () => {
    setStorageModeForTests('server');
    const state = baseState();
    setSessionStateForTests(state);

    let putBodies: unknown[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method === 'PUT') {
        putBodies.push(JSON.parse(String(init.body)));
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    touchChat(state.chats[0] as Chat);
    setSidebarCollapsed(true);
    assert.deepEqual(getSessionDirtyTrackingForTests().dirtyChatIds, [CHAT_A]);
    assert.equal(getSessionDirtyTrackingForTests().sessionScalarsDirty, true);

    // B.1: dirty set contents describe a future PATCH, but the wire call is still full PUT.
    saveSessionsNow();
    assert.equal(putBodies.length, 1);
    const body = putBodies[0] as SessionState;
    assert.equal(body.chats.length, 2);
    assert.equal(body.activeId, CHAT_A);
    assert.deepEqual(getSessionDirtyTrackingForTests(), {
      dirtyChatIds: [],
      deletedChatIds: [],
      dirtyGroupIds: [],
      sessionScalarsDirty: false,
    });
  });

  test('removeChatById records deletedChatIds', () => {
    const state = baseState();
    setSessionStateForTests(state);
    removeChatById(CHAT_B, 'm');
    const dirty = getSessionDirtyTrackingForTests();
    assert.deepEqual(dirty.deletedChatIds, [CHAT_B]);
  });

  test('verifier warns when a chat mutates without touchChat', () => {
    const state = baseState();
    setSessionStateForTests(state);
    captureDirtyTrackingShadowForTests();
    setDirtyTrackingVerifierForcedForTests(true);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      // Unmarked mutation — bypasses touchChat on purpose.
      state.chats[0]!.name = 'mutated without touch';
      saveSessionsNow();
    } finally {
      console.warn = originalWarn;
    }

    assert.ok(
      warnings.some((w) => w.includes(CHAT_A) && w.includes('without touchChat')),
      `expected verifier warning, got: ${JSON.stringify(warnings)}`,
    );
  });

  test('verifier stays quiet when mutation goes through touchChat', () => {
    const state = baseState();
    setSessionStateForTests(state);
    captureDirtyTrackingShadowForTests();
    setDirtyTrackingVerifierForcedForTests(true);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const chat = state.chats[0] as Chat;
      chat.name = 'renamed via touch';
      touchChat(chat);
      saveSessionsNow();
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 0);
  });
});
