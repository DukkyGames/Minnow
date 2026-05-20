/**
 * Workspace-scoped chats — schema v2 migration and sidebar filters.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeWorkspacePath } from '../../src/lib/normalize-workspace-path.ts';
import {
  coerceChatWorkspaceFields,
  getChatsForWorkspace,
  getUnassignedChats,
  migrateSessionStateV1ToV2,
  resolveActiveChatIdForWorkspace,
} from '../../src/state/session-workspace-scope.ts';
import type { SessionState } from '../../src/types.ts';
import { resetWorkspaceStateForTests, setWorkspaceFromServer } from '../../src/state/workspace.ts';

const CHAT_A = '11111111-1111-1111-1111-111111111111';
const CHAT_B = '22222222-2222-2222-2222-222222222222';
const CHAT_LEGACY = '33333333-3333-3333-3333-333333333333';

const PATH_A = 'C:/Projects/Alpha';
const PATH_B = 'C:/Projects/Beta';

function chatRow(
  id: string,
  name: string,
  workspacePath: string,
  updatedAt: number,
) {
  return {
    id,
    name,
    workspacePath,
    modelId: 'test-model',
    history: [] as const,
    lastStats: null,
    modelInfo: {},
    updatedAt,
  };
}

function seedState(partial: SessionState): SessionState {
  return {
    version: 2,
    sidebarCollapsed: false,
    lastActiveChatIdByWorkspace: {},
    ...partial,
  };
}

describe('migrateSessionStateV1ToV2', () => {
  it('upgrades v1 blob with empty workspacePath on every chat', () => {
    const migrated = migrateSessionStateV1ToV2(
      {
        version: 1,
        activeId: CHAT_LEGACY,
        sidebarCollapsed: false,
        chats: [
          {
            id: CHAT_LEGACY,
            name: 'Legacy',
            modelId: 'm',
            history: [],
            updatedAt: 100,
          },
        ],
      },
      coerceChatWorkspaceFields,
      () => coerceChatWorkspaceFields(null),
    );

    assert.equal(migrated.version, 2);
    assert.equal(migrated.chats.length, 1);
    assert.equal(migrated.chats[0].workspacePath, '');
    assert.deepEqual(migrated.lastActiveChatIdByWorkspace, {});
  });

  it('coerces v2 chats and preserves lastActiveChatIdByWorkspace keys', () => {
    const migrated = migrateSessionStateV1ToV2(
      {
        version: 2,
        activeId: CHAT_A,
        sidebarCollapsed: true,
        lastActiveChatIdByWorkspace: { [PATH_A]: CHAT_A },
        chats: [chatRow(CHAT_A, 'On A', PATH_A, 200)],
      },
      coerceChatWorkspaceFields,
      () => coerceChatWorkspaceFields(null),
    );

    assert.equal(migrated.version, 2);
    assert.equal(
      normalizeWorkspacePath(migrated.chats[0].workspacePath),
      normalizeWorkspacePath(PATH_A),
    );
    assert.equal(migrated.lastActiveChatIdByWorkspace?.[normalizeWorkspacePath(PATH_A)], CHAT_A);
  });
});

describe('normalizeWorkspacePath', () => {
  it('folds Windows drive letter casing', () => {
    assert.equal(
      normalizeWorkspacePath('c:/Projects/foo'),
      normalizeWorkspacePath('C:/Projects/foo'),
    );
  });
});

describe('getChatsForWorkspace', () => {
  it('returns only chats for the requested workspace', () => {
    const state = seedState({
      activeId: CHAT_A,
      chats: [
        chatRow(CHAT_A, 'A1', PATH_A, 300),
        chatRow(CHAT_B, 'B1', PATH_B, 200),
        chatRow(CHAT_LEGACY, 'Legacy', '', 100),
      ],
    });

    const onA = getChatsForWorkspace(PATH_A, state);
    assert.equal(onA.length, 1);
    assert.equal(onA[0].id, CHAT_A);

    const onB = getChatsForWorkspace(PATH_B, state);
    assert.equal(onB.length, 1);
    assert.equal(onB[0].id, CHAT_B);
  });
});

describe('getUnassignedChats', () => {
  it('lists only chats with empty workspacePath', () => {
    const state = seedState({
      activeId: CHAT_LEGACY,
      chats: [
        chatRow(CHAT_A, 'A1', PATH_A, 300),
        chatRow(CHAT_LEGACY, 'Legacy', '', 100),
      ],
    });

    const unassigned = getUnassignedChats(state);
    assert.equal(unassigned.length, 1);
    assert.equal(unassigned[0].id, CHAT_LEGACY);
  });
});

describe('resolveActiveChatIdForWorkspace', () => {
  it('restores lastActiveChatIdByWorkspace when chat still exists', () => {
    const key = normalizeWorkspacePath(PATH_A);
    const state = seedState({
      activeId: CHAT_B,
      lastActiveChatIdByWorkspace: { [key]: CHAT_A },
      chats: [
        chatRow(CHAT_A, 'A1', PATH_A, 300),
        chatRow(CHAT_B, 'B1', PATH_B, 200),
      ],
    });

    const next = resolveActiveChatIdForWorkspace(PATH_A, state, '', (modelId, ws) =>
      chatRow('new', 'New', ws, Date.now()),
    );
    assert.equal(next, CHAT_A);
  });

  it('creates a new scoped chat when workspace has none', () => {
    const state = seedState({
      activeId: CHAT_B,
      chats: [chatRow(CHAT_B, 'B1', PATH_B, 200)],
    });

    assert.equal(getChatsForWorkspace(PATH_A, state).length, 0);

    const next = resolveActiveChatIdForWorkspace(PATH_A, state, 'fallback-model', (modelId, ws) =>
      chatRow('new-chat', 'New', ws, Date.now()),
    );
    const after = getChatsForWorkspace(PATH_A, state);
    assert.equal(after.length, 1);
    assert.equal(next, after[0].id);
    assert.equal(after[0].workspacePath, normalizeWorkspacePath(PATH_A));
  });
});

describe('workspace path binding', () => {
  it('normalizes path from client workspace state', () => {
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({
      path: PATH_A,
      label: 'Alpha',
      isDefault: false,
    });

    assert.equal(normalizeWorkspacePath(PATH_A), normalizeWorkspacePath(PATH_A));
  });
});
