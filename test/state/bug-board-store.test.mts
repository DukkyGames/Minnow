/**
 * Bug board store transitions (file-backed).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  addBug,
  findBugById,
  setBugBoardNowForTests,
  setBugsStateForTests,
  updateBug,
} from '../../src/state/bug-board-store.ts';

const FIXED_NOW = 1710000002000;

describe('bug-board-store', () => {
  beforeEach(() => {
    setBugBoardNowForTests(() => FIXED_NOW);
    setBugsStateForTests({ version: 1, bugs: [] });
  });

  test('addBug creates reported card with workspace', () => {
    const card = addBug(
      {
        title: 'Login fails',
        description: '500 on submit',
        severity: 'high',
        workspacePath: '/workspace/proj',
      },
      'bug-abc',
    );
    assert.equal(card.column, 'reported');
    assert.equal(card.workspacePath, '/workspace/proj');
    assert.equal(findBugById('bug-abc')?.title, 'Login fails');
  });

  test('updateBug moves column and links chat', () => {
    addBug(
      { title: 'x', description: '', severity: 'low', workspacePath: '/w' },
      'bug-1',
    );
    const updated = updateBug('bug-1', {
      column: 'investigating',
      notes: 'Root cause in auth.ts',
      chatId: 'chat-111',
    });
    assert.ok(updated);
    assert.equal(updated?.column, 'investigating');
    assert.equal(updated?.chatId, 'chat-111');
  });
});
