/**
 * Task card activity derivation for Orchestrate Kanban.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  deriveTaskCardActivity,
} from '../../../src/chat/orchestrate/task-activity.ts';
import type { BoardTask, Chat } from '../../../src/types.ts';

const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const TASK_CHAT_ID = '22222222-2222-2222-2222-222222222222';
const RUN_ID = '33333333-3333-3333-3333-333333333333';

function baseTask(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'W1-A',
    title: 'Initialize repo',
    wave: 'W1',
    category: 'build',
    status: 'in_progress',
    ...overrides,
  };
}

function plannerChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: PLANNER_ID,
    name: 'Orchestrator',
    workspacePath: '/workspace',
    modelId: 'model',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    ...overrides,
  } as Chat;
}

function taskChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: TASK_CHAT_ID,
    name: 'Task W1-A: Initialize repo',
    workspacePath: '/workspace',
    modelId: 'model',
    history: [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"README.md"}' },
          },
        ],
      },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    ...overrides,
  } as Chat;
}

describe('deriveTaskCardActivity', () => {
  test('streaming tool phase uses describeToolInvocation label', () => {
    const activity = deriveTaskCardActivity(
      baseTask({ chatId: TASK_CHAT_ID }),
      plannerChat(),
      {
        taskChat: taskChat(),
        mainTurn: {
          chatId: TASK_CHAT_ID,
          phase: 'tools',
          currentTool: 'read_file',
          workAgentLabel: 'Builder',
          modelId: 'm',
          providerId: 'p',
          startedAtMs: 1,
        },
      },
    );

    assert.ok(activity);
    assert.equal(activity.kind, 'tool');
    assert.match(activity.text, /Running/);
    assert.match(activity.text, /Read file/i);
  });

  test('idle task chat surfaces last tool label', () => {
    const activity = deriveTaskCardActivity(
      baseTask({ chatId: TASK_CHAT_ID }),
      plannerChat(),
      { taskChat: taskChat() },
    );
    assert.ok(activity);
    assert.equal(activity.kind, 'tool');
    assert.match(activity.text, /^Tool:/);
  });

  test('no task chat with queued sub-agent shows run task summary', () => {
    const activity = deriveTaskCardActivity(baseTask({ assignedRunId: RUN_ID }), plannerChat(), {
      subAgentHint: { status: 'queued', taskLabel: 'Scaffold the API layer' },
    });
    assert.ok(activity);
    assert.match(activity.text, /Scaffold/);
  });

  test('returns null when nothing to show', () => {
    const activity = deriveTaskCardActivity(
      baseTask({ status: 'planned' }),
      plannerChat(),
    );
    assert.equal(activity, null);
  });
});
