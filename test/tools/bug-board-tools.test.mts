/**
 * bug_add / bug_update / bug_get_state — Issues store aliases (MIN-261).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setIssuesStateForTests } from '../../src/state/issues-store.ts';
import {
  executeBugBoardTool,
  setBugBoardExecutorContext,
  setGlobalBugsPageOpenForTests,
  validateBugAddArgs,
  validateBugUpdateArgs,
} from '../../src/tools/bug-board-tools.ts';
import type { Chat } from '../../src/types.ts';

const CHAT_ID = '33333333-3333-3333-3333-333333333333';

function makeChat(): Chat {
  return {
    id: CHAT_ID,
    name: 'Debug',
    workspacePath: '/workspace',
    modelId: 'test',
    modeId: 'build',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
  };
}

describe('bug-board-tools', () => {
  beforeEach(() => {
    setIssuesStateForTests({ version: 1, nextId: 1, issues: [] });
    setSessionStateForTests({
      version: 2,
      activeId: CHAT_ID,
      sidebarCollapsed: false,
      chats: [makeChat()],
    });
    setBugBoardExecutorContext({ chatId: CHAT_ID });
    setGlobalBugsPageOpenForTests(true);
  });

  test('validateBugAddArgs rejects empty title', () => {
    const r = validateBugAddArgs({ title: '  ', severity: 'medium' });
    assert.equal(r.ok, false);
  });

  test('bug_add and bug_get_state round trip', async () => {
    const addResult = await executeBugBoardTool('bug_add', {
      title: 'Crash on save',
      description: 'Null ref',
      severity: 'critical',
      bug_id: 'bug-crash',
    });
    assert.match(addResult, /"id": "bug-crash"/);

    const state = await executeBugBoardTool('bug_get_state', {});
    assert.match(state, /"column": "reported"/);

    const validated = validateBugUpdateArgs({
      bug_id: 'bug-crash',
      column: 'planned',
      plan_path: 'documentation/plans/bugs/bug-crash.md',
    });
    assert.equal(validated.ok, true);
    const updateResult = await executeBugBoardTool('bug_update', {
      bug_id: 'bug-crash',
      column: 'planned',
      plan_path: 'documentation/plans/bugs/bug-crash.md',
    });
    assert.match(updateResult, /"column": "planned"/);
  });

  test('executeBugBoardTool works when All bugs screen is closed', async () => {
    setGlobalBugsPageOpenForTests(false);
    const out = await executeBugBoardTool('bug_add', {
      title: 'x',
      severity: 'low',
    });
    assert.match(out, /"column": "reported"/);
  });
});
