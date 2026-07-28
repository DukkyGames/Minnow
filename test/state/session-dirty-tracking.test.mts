/**
 * Phase B.1/B.2: dirty-tracking + PATCH flush once dirty sets are trusted.
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
  waitForSessionSaveForTests,
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

describe('session dirty tracking (B.1/B.2)', () => {
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

  test('flush PATCHes dirty chats/scalars and clears dirty sets after success', async () => {
    setStorageModeForTests('server');
    const state = baseState();
    setSessionStateForTests(state);

    let patchBodies: unknown[] = [];
    let putCount = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/api/config/sessions') && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body)));
      }
      if (url.includes('/api/config/sessions') && init?.method === 'PUT') {
        putCount += 1;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    touchChat(state.chats[0] as Chat);
    setSidebarCollapsed(true);
    assert.deepEqual(getSessionDirtyTrackingForTests().dirtyChatIds, [CHAT_A]);
    assert.equal(getSessionDirtyTrackingForTests().sessionScalarsDirty, true);

    saveSessionsNow();
    await waitForSessionSaveForTests();

    assert.equal(putCount, 0);
    assert.equal(patchBodies.length, 1);
    const body = patchBodies[0] as {
      chats?: Chat[];
      scalars?: { sidebarCollapsed?: boolean };
    };
    assert.equal(body.chats?.length, 1);
    assert.equal(body.chats?.[0]?.id, CHAT_A);
    assert.equal(body.scalars?.sidebarCollapsed, true);
    assert.deepEqual(getSessionDirtyTrackingForTests(), {
      dirtyChatIds: [],
      deletedChatIds: [],
      dirtyGroupIds: [],
      deletedGroupIds: [],
      sessionScalarsDirty: false,
      sessionPatchDirtySetsReady: true,
      sessionsClientPatchEnabled: true,
    });
  });

  test('removeChatById records deletedChatIds', () => {
    const state = baseState();
    setSessionStateForTests(state);
    removeChatById(CHAT_B, 'm');
    const dirty = getSessionDirtyTrackingForTests();
    assert.deepEqual(dirty.deletedChatIds, [CHAT_B]);
  });

  test('removeChatById purges stale remembered workspace and app ids', () => {
    const state = baseState();
    state.lastActiveChatIdByWorkspace = { '': CHAT_B };
    state.lastActiveChatIdByApp = { chat: CHAT_B };
    setSessionStateForTests(state);
    removeChatById(CHAT_B, 'm');
    assert.equal(state.lastActiveChatIdByWorkspace[''], undefined);
    assert.equal(state.lastActiveChatIdByApp.chat, undefined);
    assert.equal(getSessionDirtyTrackingForTests().sessionScalarsDirty, true);
  });

  test('removeChatById retargets remembered ids when the active chat is deleted', () => {
    const state = baseState();
    state.chats[0]!.history = [{ role: 'user', content: 'hello' }];
    state.chats[1]!.history = [{ role: 'user', content: 'bye' }];
    state.activeId = CHAT_B;
    state.lastActiveChatIdByWorkspace = { '': CHAT_B };
    state.lastActiveChatIdByApp = { chat: CHAT_B };
    setSessionStateForTests(state);
    const result = removeChatById(CHAT_B, 'm');
    assert.equal(result.ok, true);
    assert.equal(result.activeChanged, true);
    assert.equal(state.activeId, CHAT_A);
    assert.equal(state.lastActiveChatIdByWorkspace[''], CHAT_A);
    assert.equal(state.lastActiveChatIdByApp.chat, CHAT_A);
  });

  test('removeChatById switches to another unassigned chat when active is deleted', () => {
    const state = baseState();
    state.chats[0]!.history = [{ role: 'user', content: 'hello' }];
    state.chats[1]!.history = [{ role: 'user', content: 'bye' }];
    state.activeId = CHAT_B;
    setSessionStateForTests(state);
    const result = removeChatById(CHAT_B, 'm');
    assert.equal(result.ok, true);
    assert.equal(result.activeChanged, true);
    assert.equal(state.activeId, CHAT_A);
    assert.equal(state.chats.some((c) => c.id === CHAT_B), false);
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

  test('verifier stays quiet when mutation goes through touchChat', async () => {
    setStorageModeForTests('server');
    const state = baseState();
    setSessionStateForTests(state);
    captureDirtyTrackingShadowForTests();
    setDirtyTrackingVerifierForcedForTests(true);

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 });

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
      await waitForSessionSaveForTests();
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 0);
  });
});
