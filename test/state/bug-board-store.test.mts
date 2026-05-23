/**
 * Bug board store transitions.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  addBug,
  setBugBoardNowForTests,
  updateBug,
} from '../../src/state/bug-board-store.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat } from '../../src/types.ts';

const CHAT_ID = '22222222-2222-2222-2222-222222222222';
const FIXED_NOW = 1710000002000;

function makeChat(): Chat {
  return {
    id: CHAT_ID,
    name: 'Bug chat',
    workspacePath: '/workspace',
    modelId: 'test',
    modeId: 'debug',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: FIXED_NOW,
  };
}

describe('bug-board-store', () => {
  beforeEach(() => {
    setBugBoardNowForTests(() => FIXED_NOW);
    setSessionStateForTests({
      version: 2,
      activeId: CHAT_ID,
      sidebarCollapsed: false,
      chats: [makeChat()],
    });
  });

  test('addBug creates reported card', () => {
    const chat = makeChat();
    const card = addBug(
      chat,
      { title: 'Login fails', description: '500 on submit', severity: 'high' },
      'bug-abc',
    );
    assert.equal(card.column, 'reported');
    assert.equal(card.severity, 'high');
    assert.equal(chat.bugBoard?.bugs.length, 1);
  });

  test('updateBug moves column and notes', () => {
    const chat = makeChat();
    addBug(chat, { title: 'x', description: '', severity: 'low' }, 'bug-1');
    const updated = updateBug(chat, 'bug-1', {
      column: 'investigating',
      notes: 'Root cause in auth.ts',
    });
    assert.ok(updated);
    assert.equal(updated?.column, 'investigating');
    assert.equal(updated?.notes, 'Root cause in auth.ts');
  });
});
