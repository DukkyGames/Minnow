/**
 * Issues expand pipeline pure builders.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildIssueExpandTask,
  canExpandIssueWithAgent,
} from '../../src/chat/issues/expand-task.ts';
import { resolveIssueSubAgentChatId } from '../../src/chat/issues/pipeline.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';
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

  test('resolveIssueSubAgentChatId prefers persisted subAgentRuns on linked chats', () => {
    const parent = createEmptyChatObject('model', '/workspace');
    parent.id = 'chat-parent';
    parent.subAgentRuns = [
      {
        runId: 'run-abc',
        type: 'debugger',
        status: 'completed',
        task: 'investigate',
        startedAt: 1,
        finishedAt: 2,
      },
    ];
    setSessionStateForTests({ chats: [parent], activeId: parent.id });

    const issue = makeIssue({
      status: 'in_progress',
      investigateRunId: 'run-abc',
      chatIds: ['other-chat', 'chat-parent'],
    });

    assert.equal(resolveIssueSubAgentChatId(issue, 'run-abc'), 'chat-parent');
    assert.equal(
      resolveIssueSubAgentChatId(makeIssue({ chatIds: ['chat-fallback'] }), 'run-missing'),
      'chat-fallback',
    );
  });
});
