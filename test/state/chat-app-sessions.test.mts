/**
 * Minnow Chat app session scoping (assistant chats vs Code workspace).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isChatsWorkspacePath } from '../../src/lib/chats-workspace.ts';
import { normalizeWorkspacePath } from '../../src/lib/normalize-workspace-path.ts';
import {
  CHAT_APP_ID,
  EMAIL_APP_ID,
  createAssistantChat,
  createDesktopChat,
  createEmailAssistantChat,
  getAssistantChats,
  getChatsForChatsWorkspace,
  getEmailAssistantChats,
  getListedEmailAssistantChats,
  getLastActiveChatIdForApp,
  isAssistantChat,
  migrateSessionStateV1ToV2,
  rememberActiveChatForApp,
  resolveActiveAssistantChatId,
  resolveActiveEmailAssistantChatId,
  coerceChatWorkspaceFields,
} from '../../src/state/session-workspace-scope.ts';
import type { Chat, SessionState } from '../../src/types.ts';

const CHATS_WS = 'C:/Users/me/.minnow/chats';
const CODE_WS = 'C:/Projects/Minnow';

const ASSISTANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ASSISTANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CODE_CHAT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EMAIL_CHAT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

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

  test('Chat app lists exclude Email-scoped conversations in the same sandbox', () => {
    const state = seedState({
      chats: [
        chatRow(ASSISTANT_A, CHATS_WS, 300),
        chatRow(EMAIL_CHAT, CHATS_WS, 250, {
          appScope: 'email',
          modeId: 'email',
        }),
      ],
    });

    assert.deepEqual(
      getChatsForChatsWorkspace(state, CHATS_WS).map((chat) => chat.id),
      [ASSISTANT_A],
    );
    assert.deepEqual(
      getAssistantChats(state, CHATS_WS).map((chat) => chat.id),
      [ASSISTANT_A],
    );
  });

  test('getAssistantChats includes expert threads in the chats workspace', () => {
    const state = seedState({
      chats: [
        chatRow(ASSISTANT_A, CHATS_WS, 300),
        chatRow(ASSISTANT_B, CHATS_WS, 200, { kind: 'expert' }),
      ],
    });

    const visible = getAssistantChats(state, CHATS_WS);
    assert.equal(visible.length, 2);
    assert.equal(visible[0].id, ASSISTANT_A);
    assert.equal(visible[1].id, ASSISTANT_B);
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
  test('defaults to general mode, workAgentAuto, and workspace path', () => {
    const desktopWs = '/home/user/.minnow/workspace';
    const chat = createDesktopChat(desktopWs, 'chat-desktop-1', 'model-x');
    assert.equal(chat.modeId, 'general');
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

describe('Email assistant chats', () => {
  test('factory uses Email mode and an explicit app scope', () => {
    const chat = createEmailAssistantChat(CHATS_WS, EMAIL_CHAT, 'model-x');
    assert.equal(chat.id, EMAIL_CHAT);
    assert.equal(chat.appScope, 'email');
    assert.equal(chat.modeId, 'email');
    assert.equal(chat.workAgentAuto, true);
    assert.equal(chat.modelId, 'model-x');
    assert.equal(normalizeWorkspacePath(chat.workspacePath), normalizeWorkspacePath(CHATS_WS));
  });

  test('resolver restores the remembered Email chat without selecting Chat app rows', () => {
    const state = seedState({
      chats: [
        chatRow(ASSISTANT_A, CHATS_WS, 400),
        chatRow(EMAIL_CHAT, CHATS_WS, 300, {
          appScope: 'email',
          modeId: 'email',
        }),
      ],
      lastActiveChatIdByApp: { [EMAIL_APP_ID]: EMAIL_CHAT },
    });

    const resolved = resolveActiveEmailAssistantChatId(CHATS_WS, state, (path) =>
      createEmailAssistantChat(path, 'unused'),
    );
    assert.equal(resolved, EMAIL_CHAT);
    assert.deepEqual(
      getEmailAssistantChats(state, CHATS_WS).map((chat) => chat.id),
      [EMAIL_CHAT],
    );
    assert.deepEqual(
      getListedEmailAssistantChats(state, CHATS_WS).map((chat) => chat.id),
      [EMAIL_CHAT],
    );
  });

  test('new Email chats remain history-hidden until they have a turn or draft', () => {
    const state = seedState({ chats: [chatRow(CODE_CHAT, CODE_WS, 100)] });
    const resolved = resolveActiveEmailAssistantChatId(CHATS_WS, state, (path) =>
      createEmailAssistantChat(path, EMAIL_CHAT),
    );

    assert.equal(resolved, EMAIL_CHAT);
    assert.equal(getEmailAssistantChats(state, CHATS_WS).length, 1);
    assert.equal(getListedEmailAssistantChats(state, CHATS_WS).length, 0);
  });
});
