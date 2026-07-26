/**
 * issue_* tools + bug_* aliases (no screen gate).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setIssuesStateForTests } from '../../src/state/issues-store.ts';
import {
  executeIssueTool,
  validateIssueAddArgs,
  validateIssueDeleteArgs,
  validateIssueLinkArgs,
  validateIssueUpdateArgs,
} from '../../src/tools/issue-tools.ts';
import {
  executeBugBoardTool,
  setGlobalBugsPageOpenForTests,
  validateBugAddArgs,
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

describe('issue-tools', () => {
  beforeEach(() => {
    setIssuesStateForTests({ version: 1, nextId: 1, issues: [] });
    setSessionStateForTests({
      version: 2,
      activeId: CHAT_ID,
      sidebarCollapsed: false,
      chats: [makeChat()],
    });
    setGlobalBugsPageOpenForTests(false);
  });

  test('validateIssueAddArgs rejects empty title', () => {
    const r = validateIssueAddArgs({ title: '  ' });
    assert.equal(r.ok, false);
  });

  test('issue_add and issue_get_state round trip', async () => {
    const addResult = await executeIssueTool('issue_add', {
      title: 'Ship Issues app',
      description: 'Phase 1',
      type: 'task',
      priority: 'high',
      issue_id: 'ISS-42',
    });
    assert.match(addResult, /"id": "ISS-42"/);
    assert.match(addResult, /"status": "triage"/);

    const state = await executeIssueTool('issue_get_state', {
      workspace_scope: 'all',
    });
    assert.match(state, /ISS-42/);

    const validated = validateIssueUpdateArgs({
      issue_id: 'ISS-42',
      status: 'planned',
      plan_path: 'documentation/plans/issues/ISS-42.md',
    });
    assert.equal(validated.ok, true);
    const updateResult = await executeIssueTool('issue_update', {
      issue_id: 'ISS-42',
      status: 'planned',
      plan_path: 'documentation/plans/issues/ISS-42.md',
    });
    assert.match(updateResult, /"status": "planned"/);
  });

  test('issue_link appends code refs and chat id', async () => {
    await executeIssueTool('issue_add', {
      title: 'Link me',
      issue_id: 'ISS-9',
    });
    const bad = validateIssueLinkArgs({ issue_id: 'ISS-9' });
    assert.equal(bad.ok, false);

    const ok = validateIssueLinkArgs({
      issue_id: 'ISS-9',
      code_refs: [{ path: 'src/a.ts', start_line: 2, end_line: 5, snippet: 'x' }],
      chat_id: CHAT_ID,
    });
    assert.equal(ok.ok, true);

    const linked = await executeIssueTool('issue_link', {
      issue_id: 'ISS-9',
      code_refs: [{ path: 'src/a.ts', start_line: 2, end_line: 5, snippet: 'x' }],
      chat_id: CHAT_ID,
    });
    assert.match(linked, /"path": "src\/a\.ts"/);
    assert.match(linked, new RegExp(CHAT_ID));

    // Append-only: duplicate path/range does not grow the list.
    const again = await executeIssueTool('issue_link', {
      issue_id: 'ISS-9',
      code_refs: [{ path: 'src/a.ts', start_line: 2, end_line: 5 }],
    });
    const parsed = JSON.parse(again) as { codeRefs?: unknown[] };
    assert.equal(parsed.codeRefs?.length, 1);
  });

  test('issue_delete removes one or many issues', async () => {
    await executeIssueTool('issue_add', { title: 'Keep', issue_id: 'ISS-1' });
    await executeIssueTool('issue_add', { title: 'Drop A', issue_id: 'ISS-2' });
    await executeIssueTool('issue_add', { title: 'Drop B', issue_id: 'ISS-3' });

    const bad = validateIssueDeleteArgs({});
    assert.equal(bad.ok, false);

    const missing = await executeIssueTool('issue_delete', { issue_id: 'ISS-999' });
    assert.match(missing, /unknown issue_id/);

    const single = await executeIssueTool('issue_delete', { issue_id: 'ISS-2' });
    assert.match(single, /"deleted": true/);
    assert.match(single, /"issue_id": "ISS-2"/);

    const bulk = await executeIssueTool('issue_delete', {
      issue_ids: ['ISS-3', 'ISS-missing'],
    });
    assert.match(bulk, /"deleted": 1/);

    const state = await executeIssueTool('issue_get_state', { workspace_scope: 'all' });
    assert.match(state, /ISS-1/);
    assert.doesNotMatch(state, /ISS-2/);
    assert.doesNotMatch(state, /ISS-3/);
  });

  test('bug_* aliases work without All bugs screen', async () => {
    assert.equal(validateBugAddArgs({ title: 'Crash', severity: 'critical' }).ok, true);
    const addResult = await executeBugBoardTool('bug_add', {
      title: 'Crash on save',
      description: 'Null ref',
      severity: 'critical',
      bug_id: 'bug-crash',
    });
    assert.match(addResult, /"id": "bug-crash"/);
    assert.match(addResult, /"column": "reported"/);

    const state = await executeBugBoardTool('bug_get_state', {});
    assert.match(state, /"column": "reported"/);

    const updateResult = await executeBugBoardTool('bug_update', {
      bug_id: 'bug-crash',
      column: 'planned',
      plan_path: 'documentation/plans/bugs/bug-crash.md',
    });
    assert.match(updateResult, /"column": "planned"/);
  });
});
