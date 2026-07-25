/**
 * Issues expand pipeline pure builders.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildIssueExpandTask,
  canExpandIssueWithAgent,
} from '../../src/chat/issues/expand-task.ts';
import type { IssueCard } from '../../src/types.ts';

function makeIssue(overrides: Partial<IssueCard> = {}): IssueCard {
  return {
    id: 'ISS-7',
    type: 'note',
    title: 'login broken somehow',
    description: '',
    status: 'triage',
    priority: 'none',
    labels: [],
    workspacePath: '/workspace',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('issues pipeline builders', () => {
  test('canExpandIssueWithAgent only in triage', () => {
    assert.equal(canExpandIssueWithAgent(makeIssue()), true);
    assert.equal(canExpandIssueWithAgent(makeIssue({ status: 'todo' })), false);
  });

  test('buildIssueExpandTask includes id and triage constraint', () => {
    const task = buildIssueExpandTask(
      makeIssue({ description: 'Null when saving settings' }),
    );
    assert.match(task, /ISS-7/);
    assert.match(task, /Status must remain: triage/);
    assert.match(task, /issue_update/);
    assert.match(task, /issue_link/);
    assert.match(task, /Null when saving settings/);
  });
});
