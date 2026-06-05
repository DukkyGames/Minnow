/**
 * Per-chat code change totals ledger.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Chat } from '../../src/types.ts';
import type { SessionState } from '../../src/types.ts';
import {
  EMPTY_CODE_CHANGE_TOTALS,
  ensureCodeChangeTotals,
  formatCodeChangeTotalsText,
  getWorkspaceCodeChangeTotals,
  hasCodeChangeTotals,
  recordCodeChange,
  recordWorkspaceCodeChange,
  resetCodeChangeTotals,
  sumChatCodeChangeTotalsForWorkspace,
} from '../../src/usage/code-change-ledger.ts';

function makeChat(): Chat {
  return {
    id: 'chat-code-ledger',
    name: 'Test',
    workspacePath: '',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1_700_000_000_000,
  };
}

describe('code-change-ledger', () => {
  test('recordCodeChange increments totals', () => {
    const chat = makeChat();
    recordCodeChange(chat, { additions: 12, deletions: 3, path: 'src/a.ts' });
    recordCodeChange(chat, { additions: 1, deletions: 0 });
    assert.deepEqual(chat.codeChangeTotals, { additions: 13, deletions: 3 });
  });

  test('skips zero stats', () => {
    const chat = makeChat();
    recordCodeChange(chat, { additions: 0, deletions: 0 });
    assert.equal(chat.codeChangeTotals, undefined);
  });

  test('reset restores empty totals', () => {
    const chat = makeChat();
    recordCodeChange(chat, { additions: 5, deletions: 1 });
    resetCodeChangeTotals(chat);
    assert.deepEqual(chat.codeChangeTotals, EMPTY_CODE_CHANGE_TOTALS);
  });

  test('ensureCodeChangeTotals initializes object', () => {
    const chat = makeChat();
    const totals = ensureCodeChangeTotals(chat);
    assert.deepEqual(totals, EMPTY_CODE_CHANGE_TOTALS);
  });

  test('format and has helpers', () => {
    assert.equal(hasCodeChangeTotals(undefined), false);
    assert.equal(hasCodeChangeTotals({ additions: 0, deletions: 0 }), false);
    assert.equal(
      formatCodeChangeTotalsText({ additions: 10, deletions: 2 }),
      '+10 −2',
    );
    assert.equal(hasCodeChangeTotals({ additions: 1, deletions: 0 }), true);
  });

  test('recordWorkspaceCodeChange and sum across chats', () => {
    const state: SessionState = {
      version: 5,
      activeId: null,
      sidebarCollapsed: false,
      chats: [],
    };
    recordWorkspaceCodeChange(state, '/proj', { additions: 3, deletions: 1 });
    assert.deepEqual(getWorkspaceCodeChangeTotals(state, '/proj'), {
      additions: 3,
      deletions: 1,
    });

    const chatA = makeChat();
    chatA.workspacePath = '/proj';
    chatA.codeChangeTotals = { additions: 2, deletions: 0 };
    const chatB = { ...makeChat(), id: 'b', codeChangeTotals: { additions: 1, deletions: 2 } };
    chatB.workspacePath = '/proj';
    state.chats = [chatA, chatB];
    assert.deepEqual(sumChatCodeChangeTotalsForWorkspace(state, '/proj'), {
      additions: 3,
      deletions: 2,
    });
  });
});
