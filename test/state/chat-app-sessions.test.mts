/**
 * MinnowOS Chat app session scoping (assistant chats vs Code workspace).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isChatsWorkspacePath } from '../../src/lib/chats-workspace.ts';
import { normalizeWorkspacePath } from '../../src/lib/normalize-workspace-path.ts';
import {
  CHAT_APP_ID,
  createAssistantChat,
  createDesktopChat,
  getAssistantChats,
  getChatsForChatsWorkspace,
  getLastActiveChatIdForApp,
  isAssistantChat,
  migrateSessionStateV1ToV2,
  rememberActiveChatForApp,
  resolveActiveAssistantChatId,
  coerceChatWorkspaceFields,
} from '../../src/state/session-workspace-scope.ts';
import type { Chat, SessionState } from '../../src/types.ts';

const CHATS_WS = 'C:/Users/me/.minnow/chats';
const CODE_WS = 'C:/Projects/Minnow';

const ASSISTANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ASSISTANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CODE_CHAT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function chatRow(
  id: string,
  workspacePath: string,
  updatedAt: number,
  overrides: Partial<Chat> = {},
): Chat {
  return {
    id,
    name: 'Test',
    workspacePath: normalizeWorkspacePath(workspacePath),
    modelId: 'test-model',
    modeId: 'build',
    // Sidebar list helpers hide ephemeral empty chats; seed one turn for fixtures.
    history: [{ role: 'user', content: 'fixture' }],
    lastStats: null,
    modelInfo: {},
    updatedAt,
    lastMessageAt: updatedAt,
    ...overrides,
  };
}

function seedState(partial: Partial<SessionState>): SessionState {
  return {
    version: 5,
    activeId: CODE_CHAT,
    sidebarCollapsed: false,
    lastActiveChatIdByWorkspace: {},
    lastActiveChatIdByApp: {},
    chats: [],
    ...partial,
  };
}

describe('assistant vs code chat filters', () => {
  test('getChatsForChatsWorkspace returns only chats workspace chats', () => {
    const state = seedState({
      chats: [
        chatRow(ASSISTANT_A, CHATS_WS, 300),
        chatRow(CODE_CHAT, CODE_WS, 200),
        chatRow(ASSISTANT_B, CHATS_WS, 100),
      ],
    });

    const assistant = getChatsForChatsWorkspace(state, CHATS_WS);
    assert.equal(assistant.length, 2);
    assert.equal(assistant[0].id, ASSISTANT_A);
    assert.equal(assistant[1].id, ASSISTANT_B);

    const codeOnly = getChatsForChatsWorkspace(state, CODE_WS);
    assert.equal(codeOnly.length, 1);
    assert.equal(codeOnly[0].id, CODE_CHAT);
  });

  test('getAssistantChats excludes expert sidebar-hidden kinds', () => {
    const state = seedState({
      chats: [
        chatRow(ASSISTANT_A, CHATS_WS, 300),
        chatRow(ASSISTANT_B, CHATS_WS, 200, { kind: 'expert' }),
      ],
    });

    const visible = getAssistantChats(state, CHATS_WS);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, ASSISTANT_A);
  });

  test('isAssistantChat and isChatsWorkspacePath agree on chats sandbox paths', () => {
    const assistant = chatRow(ASSISTANT_A, CHATS_WS, 100);
    assert.equal(isAssistantChat(assistant, CHATS_WS), true);
    assert.equal(isChatsWorkspacePath(assistant.workspacePath ?? '', CHATS_WS), true);
    assert.equal(isAssistantChat(chatRow(CODE_CHAT, CODE_WS, 100), CHATS_WS), false);
  });
});

describe('lastActiveChatIdByApp', () => {
  test('migrates and preserves lastActiveChatIdByApp from raw session JSON', () => {
    const migrated = migrateSessionStateV1ToV2(
      {
        version: 5,
        activeId: ASSISTANT_A,
        sidebarCollapsed: false,
        lastActiveChatIdByApp: { [CHAT_APP_ID]: ASSISTANT_A },
        chats: [chatRow(ASSISTANT_A, CHATS_WS, 100)],
      },
      coerceChatWorkspaceFields,
      () => coerceChatWorkspaceFields(null),
    );

    assert.deepEqual(migrated.lastActiveChatIdByApp, { [CHAT_APP_ID]: ASSISTANT_A });
    assert.equal(getLastActiveChatIdForApp(migrated, CHAT_APP_ID), ASSISTANT_A);
  });

  test('rememberActiveChatForApp stores chat id per app', () => {
    const state = seedState({ chats: [chatRow(ASSISTANT_A, CHATS_WS, 100)] });
    rememberActiveChatForApp(state, CHAT_APP_ID, ASSISTANT_A);
    assert.equal(state.lastActiveChatIdByApp?.[CHAT_APP_ID], ASSISTANT_A);
    rememberActiveChatForApp(state, CHAT_APP_ID, ASSISTANT_B);
    assert.equal(state.lastActiveChatIdByApp?.[CHAT_APP_ID], ASSISTANT_B);
  });

  test('resolveActiveAssistantChatId restores remembered chat then newest assistant chat', () => {
    const state = seedState({
      chats: [
        chatRow(ASSISTANT_A, CHATS_WS, 300),
        chatRow(ASSISTANT_B, CHATS_WS, 200),
        chatRow(CODE_CHAT, CODE_WS, 100),
      ],
      lastActiveChatIdByApp: { [CHAT_APP_ID]: ASSISTANT_B },
    });

    const restored = resolveActiveAssistantChatId(CHATS_WS, state, (path) =>
      createAssistantChat(path, 'unused'),
    );
    assert.equal(restored, ASSISTANT_B);

    delete state.lastActiveChatIdByApp;
    const newest = resolveActiveAssistantChatId(CHATS_WS, state, (path) =>
      createAssistantChat(path, 'unused'),
    );
    assert.equal(newest, ASSISTANT_A);
  });
});

describe('createDesktopChat', () => {
  test('defaults to desktop mode, workAgentAuto, and workspace path', () => {
    const desktopWs = '/home/user/.minnow/workspace';
    const chat = createDesktopChat(desktopWs, 'chat-desktop-1', 'model-x');
    assert.equal(chat.modeId, 'desktop');
    assert.equal(chat.workAgentAuto, true);
    assert.equal(chat.modelId, 'model-x');
    assert.equal(normalizeWorkspacePath(chat.workspacePath), normalizeWorkspacePath(desktopWs));
  });
});

describe('createAssistantChat', () => {
  test('defaults to general mode, workAgentAuto, and chats workspace path', () => {
    const chat = createAssistantChat(CHATS_WS, ASSISTANT_A, 'model-x');
    assert.equal(chat.id, ASSISTANT_A);
    assert.equal(chat.modeId, 'general');
    assert.equal(chat.workAgentAuto, true);
    assert.equal(chat.modelId, 'model-x');
    assert.equal(normalizeWorkspacePath(chat.workspacePath), normalizeWorkspacePath(CHATS_WS));
  });

  test('resolveActiveAssistantChatId creates assistant chat when workspace has none', () => {
    const state = seedState({
      chats: [chatRow(CODE_CHAT, CODE_WS, 100)],
    });

    const next = resolveActiveAssistantChatId(CHATS_WS, state, (path) =>
      createAssistantChat(path, ASSISTANT_A),
    );
    assert.equal(next, ASSISTANT_A);
    // New assistant chats start ephemeral until the user sends or drafts text.
    assert.equal(getChatsForChatsWorkspace(state, CHATS_WS).length, 1);
    assert.equal(getAssistantChats(state, CHATS_WS).length, 0);
    const created = state.chats.find((c) => c.id === ASSISTANT_A);
    assert.ok(created);
    assert.equal(created?.modeId, 'general');
    assert.equal(created?.workAgentAuto, true);
  });
});
