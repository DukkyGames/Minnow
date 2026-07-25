/**
 * Issues store: add/update, migration mapping, id sequencing.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  addIssue,
  bugColumnToIssueStatus,
  bugSeverityToIssuePriority,
  findIssueById,
  isBugColumn,
  isBugSeverity,
  migrateBugCardToIssue,
  migrateBugsToIssuesState,
  migrateLegacyBugBoardsFromChats,
  setIssuesNowForTests,
  setIssuesStateForTests,
  updateIssue,
} from '../../src/state/issues-store.ts';
import type { BugCard, Chat } from '../../src/types.ts';

const FIXED_NOW = 1710000002000;

describe('issues-store', () => {
  beforeEach(() => {
    setIssuesNowForTests(() => FIXED_NOW);
    setIssuesStateForTests({ version: 1, nextId: 1, issues: [] });
  });

  test('addIssue allocates sequential ISS-n ids', () => {
    const a = addIssue({ title: 'First', workspacePath: '/w' });
    const b = addIssue({ title: 'Second', workspacePath: '/w' });
    assert.equal(a.id, 'ISS-1');
    assert.equal(b.id, 'ISS-2');
    assert.equal(a.status, 'triage');
    assert.equal(a.type, 'task');
  });

  test('updateIssue patches status and notes', () => {
    addIssue({ title: 'x', workspacePath: '/w' }, 'ISS-9');
    const updated = updateIssue('ISS-9', {
      status: 'in_progress',
      notes: 'Looking into it',
    });
    assert.ok(updated);
    assert.equal(updated?.status, 'in_progress');
    assert.equal(updated?.notes, 'Looking into it');
    assert.equal(findIssueById('ISS-9')?.status, 'in_progress');
  });

  test('bug column and severity maps cover all legacy values', () => {
    assert.equal(bugColumnToIssueStatus('reported'), 'triage');
    assert.equal(bugColumnToIssueStatus('investigating'), 'in_progress');
    assert.equal(bugColumnToIssueStatus('planned'), 'planned');
    assert.equal(bugColumnToIssueStatus('fixing'), 'in_progress');
    assert.equal(bugColumnToIssueStatus('complete'), 'done');
    assert.equal(bugSeverityToIssuePriority('critical'), 'urgent');
    assert.equal(bugSeverityToIssuePriority('high'), 'high');
    assert.equal(bugSeverityToIssuePriority('medium'), 'medium');
    assert.equal(bugSeverityToIssuePriority('low'), 'low');
  });

  test('migrateBugsToIssuesState preserves legacyBugId and severity', () => {
    const bugs: BugCard[] = [
      {
        id: 'bug-a',
        title: 'Crash',
        description: 'null ref',
        severity: 'critical',
        column: 'investigating',
        workspacePath: '/proj',
        createdAt: 1,
        updatedAt: 2,
        notes: 'auth.ts',
        chatId: 'chat-1',
      },
      {
        id: 'bug-b',
        title: 'Typo',
        description: '',
        severity: 'low',
        column: 'complete',
        workspacePath: '/proj',
        createdAt: 3,
        updatedAt: 4,
      },
    ];
    const state = migrateBugsToIssuesState(bugs);
    assert.equal(state.nextId, 3);
    assert.equal(state.issues.length, 2);
    assert.equal(state.issues[0]?.id, 'ISS-1');
    assert.equal(state.issues[0]?.legacyBugId, 'bug-a');
    assert.equal(state.issues[0]?.severity, 'critical');
    assert.equal(state.issues[0]?.priority, 'urgent');
    assert.equal(state.issues[0]?.status, 'in_progress');
    assert.equal(state.issues[0]?.chatIds?.[0], 'chat-1');
    assert.equal(state.issues[1]?.status, 'done');
    assert.equal(state.issues[1]?.priority, 'low');

    const single = migrateBugCardToIssue(bugs[0]!, 'ISS-99');
    assert.equal(single.id, 'ISS-99');
    assert.equal(single.type, 'bug');
  });

  test('isBugColumn and isBugSeverity guard legacy alias args', () => {
    assert.equal(isBugColumn('reported'), true);
    assert.equal(isBugColumn('triage'), false);
    assert.equal(isBugSeverity('critical'), true);
    assert.equal(isBugSeverity('urgent'), false);
  });

  test('migrateLegacyBugBoardsFromChats imports chat.bugBoard then strips it', async () => {
    const chat = {
      id: 'chat-legacy',
      workspacePath: '/proj',
      bugBoard: {
        bugs: [
          {
            id: 'bug-from-chat',
            title: 'From chat board',
            description: 'legacy',
            severity: 'high',
            column: 'reported',
            workspacePath: '',
            createdAt: 10,
            updatedAt: 11,
          },
        ],
        startedAt: 10,
        lastUpdatedAt: 11,
      },
    } as Chat;

    const changed = await migrateLegacyBugBoardsFromChats([chat]);
    assert.equal(changed, true);
    const imported = findIssueById('bug-from-chat');
    assert.ok(imported);
    assert.equal(imported?.title, 'From chat board');
    assert.equal(imported?.legacyBugId, 'bug-from-chat');
    assert.equal(imported?.priority, 'high');
    assert.equal(chat.bugBoard, undefined);
  });
});
