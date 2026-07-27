/**
 * MinnowOS Chat app session scoping (assistant chats vs Code workspace).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isChatsWorkspacePath } from '../../src/lib/chats-workspace.ts';
import { normalizeWorkspacePath } from '../../src/lib/normalize-workspace-path.ts';
import {
  CHAT_APP_ID,
  DESKTOP_APP_ID,
  EMAIL_APP_ID,
  createAssistantChat,
  createDesktopChat,
  createEmailAssistantChat,
  getAssistantChats,
  getChatsForChatsWorkspace,
  getDesktopChats,
  resolveActiveDesktopChatId,
  resolveActiveDesktopChatIdForWorkspace,
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

/** A Chat app thread — membership comes from `appScope`, not the folder. */
function assistantRow(
  id: string,
  workspacePath: string,
  updatedAt: number,
  overrides: Partial<Chat> = {},
): Chat {
  return chatRow(id, workspacePath, updatedAt, {
    appScope: 'chat',
    modeId: 'general',
    ...overrides,
  });
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
  test('getChatsForChatsWorkspace returns only Chat app threads', () => {
    const state = seedState({
      chats: [
        assistantRow(ASSISTANT_A, CHATS_WS, 300),
        chatRow(CODE_CHAT, CODE_WS, 200),
        assistantRow(ASSISTANT_B, CHATS_WS, 100),
      ],
    });

    const assistant = getChatsForChatsWorkspace(state, CHATS_WS);
    assert.equal(assistant.length, 2);
    assert.equal(assistant[0].id, ASSISTANT_A);
    assert.equal(assistant[1].id, ASSISTANT_B);
  });

  test('a Code chat sitting in the chats sandbox is not a Chat app thread', () => {
    // Regression: membership was inferred by comparing workspacePath to the live
    // chats/desktop workspace, so a Code chat whose folder happened to match was
    // listed in the app rail (and the app's own threads went missing when the
    // workspace moved).
    const state = seedState({
      chats: [
        chatRow(CODE_CHAT, CHATS_WS, 300),
        assistantRow(ASSISTANT_A, CODE_WS, 200),
      ],
    });

    assert.deepEqual(
      getChatsForChatsWorkspace(state, CHATS_WS).map((c) => c.id),
      [ASSISTANT_A],
    );
  });

  test('Chat app lists exclude Email-scoped conversations in the same sandbox', () => {
    const state = seedState({
      chats: [
        assistantRow(ASSISTANT_A, CHATS_WS, 300),
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
        assistantRow(ASSISTANT_A, CHATS_WS, 300),
        chatRow(ASSISTANT_B, CHATS_WS, 200, { kind: 'expert' }),
      ],
    });

    const visible = getAssistantChats(state, CHATS_WS);
    assert.equal(visible.length, 2);
    assert.equal(visible[0].id, ASSISTANT_A);
    assert.equal(visible[1].id, ASSISTANT_B);
  });

  test('isAssistantChat reads app scope, not the folder', () => {
    const assistant = assistantRow(ASSISTANT_A, CHATS_WS, 100);
    assert.equal(isAssistantChat(assistant), true);
    assert.equal(isChatsWorkspacePath(assistant.workspacePath ?? '', CHATS_WS), true);
    // Same folder, no app scope -> a Code chat.
    assert.equal(isAssistantChat(chatRow(CODE_CHAT, CHATS_WS, 100)), false);
    // Chat app thread pointed at a project folder is still a Chat app thread.
    assert.equal(isAssistantChat(assistantRow(ASSISTANT_B, CODE_WS, 100)), true);
  });
});

describe('desktop chat scoping', () => {
  const DESKTOP_WS = 'C:/Users/me/.minnow/workspace';
  const PROJECT_WS = 'C:/Users/me/Projects/Business Simulator';

  function desktopRow(id: string, workspacePath: string, updatedAt: number): Chat {
    return chatRow(id, workspacePath, updatedAt, {
      appScope: 'desktop',
      modeId: 'desktop',
    });
  }

  test('desktop threads are one list across folders', () => {
    const state = seedState({
      chats: [
        desktopRow(ASSISTANT_A, DESKTOP_WS, 300),
        desktopRow(ASSISTANT_B, PROJECT_WS, 200),
        chatRow(CODE_CHAT, DESKTOP_WS, 100),
      ],
    });

    // The Code chat sharing the desktop folder stays out; the desktop thread in a
    // project folder stays in.
    assert.deepEqual(
      getDesktopChats(state).map((c) => c.id),
      [ASSISTANT_A, ASSISTANT_B],
    );
  });

  test('resolveActiveDesktopChatId restores a thread from another folder', () => {
    const state = seedState({
      chats: [
        desktopRow(ASSISTANT_A, DESKTOP_WS, 300),
        desktopRow(ASSISTANT_B, PROJECT_WS, 200),
      ],
      lastActiveChatIdByApp: { [DESKTOP_APP_ID]: ASSISTANT_B },
    });

    // Folder-independent: the caller re-points the desktop workspace to match.
    assert.equal(
      resolveActiveDesktopChatId(DESKTOP_WS, state, (path) =>
        createDesktopChat(path, 'unused'),
      ),
      ASSISTANT_B,
    );
  });

  test('resolveActiveDesktopChatId ignores Code chats in the desktop folder', () => {
    const state = seedState({ chats: [chatRow(CODE_CHAT, DESKTOP_WS, 300)] });

    const id = resolveActiveDesktopChatId(DESKTOP_WS, state, (path) =>
      createDesktopChat(path, 'fresh-desktop'),
    );
    assert.equal(id, 'fresh-desktop');
    assert.equal(state.chats.find((c) => c.id === id)?.appScope, 'desktop');
  });

  test('resolveActiveDesktopChatIdForWorkspace remembers per-folder id', () => {
    const state = seedState({
      chats: [
        desktopRow(ASSISTANT_A, DESKTOP_WS, 300),
        desktopRow(ASSISTANT_B, PROJECT_WS, 200),
      ],
      lastActiveChatIdByWorkspace: { [PROJECT_WS]: ASSISTANT_B },
      lastActiveChatIdByApp: { [DESKTOP_APP_ID]: ASSISTANT_A },
    });

    assert.equal(
      resolveActiveDesktopChatIdForWorkspace(PROJECT_WS, state, (path) =>
        createDesktopChat(path, 'unused'),
      ),
      ASSISTANT_B,
    );
  });

  test('resolveActiveDesktopChatIdForWorkspace picks newest listed chat in folder', () => {
    const state = seedState({
      chats: [
        desktopRow(ASSISTANT_A, DESKTOP_WS, 300),
        desktopRow(ASSISTANT_B, DESKTOP_WS, 200),
      ],
      lastActiveChatIdByApp: { [DESKTOP_APP_ID]: ASSISTANT_B },
    });

    assert.equal(
      resolveActiveDesktopChatIdForWorkspace(DESKTOP_WS, state, (path) =>
        createDesktopChat(path, 'unused'),
      ),
      ASSISTANT_A,
    );
  });

  test('resolveActiveDesktopChatIdForWorkspace ignores global app memory from another folder', () => {
    const state = seedState({
      chats: [
        desktopRow(ASSISTANT_A, DESKTOP_WS, 300),
        desktopRow(ASSISTANT_B, PROJECT_WS, 200),
      ],
      lastActiveChatIdByApp: { [DESKTOP_APP_ID]: ASSISTANT_B },
    });

    assert.equal(
      resolveActiveDesktopChatIdForWorkspace(DESKTOP_WS, state, (path) =>
        createDesktopChat(path, 'unused'),
      ),
      ASSISTANT_A,
    );
  });

  test('resolveActiveDesktopChatIdForWorkspace creates a fresh desktop chat when folder is empty', () => {
    const state = seedState({
      chats: [desktopRow(ASSISTANT_B, PROJECT_WS, 200)],
    });

    const id = resolveActiveDesktopChatIdForWorkspace(DESKTOP_WS, state, (path) =>
      createDesktopChat(path, 'fresh-folder-chat'),
    );
    assert.equal(id, 'fresh-folder-chat');
    assert.equal(state.chats.find((c) => c.id === id)?.workspacePath, DESKTOP_WS);
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
        chats: [assistantRow(ASSISTANT_A, CHATS_WS, 100)],
      },
      coerceChatWorkspaceFields,
      () => coerceChatWorkspaceFields(null),
    );

    assert.deepEqual(migrated.lastActiveChatIdByApp, { [CHAT_APP_ID]: ASSISTANT_A });
    assert.equal(getLastActiveChatIdForApp(migrated, CHAT_APP_ID), ASSISTANT_A);
  });

  test('rememberActiveChatForApp stores chat id per app', () => {
    const state = seedState({ chats: [assistantRow(ASSISTANT_A, CHATS_WS, 100)] });
    rememberActiveChatForApp(state, CHAT_APP_ID, ASSISTANT_A);
    assert.equal(state.lastActiveChatIdByApp?.[CHAT_APP_ID], ASSISTANT_A);
    rememberActiveChatForApp(state, CHAT_APP_ID, ASSISTANT_B);
    assert.equal(state.lastActiveChatIdByApp?.[CHAT_APP_ID], ASSISTANT_B);
  });

  test('resolveActiveAssistantChatId restores remembered chat then newest assistant chat', () => {
    const state = seedState({
      chats: [
        assistantRow(ASSISTANT_A, CHATS_WS, 300),
        assistantRow(ASSISTANT_B, CHATS_WS, 200),
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
