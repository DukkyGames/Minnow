/**
 * Configurable check-in nudge while sub-agents run (non-orchestrate).
 *
 * Automatic nudge scheduling lived on the deleted controller. The renderer
 * still offers a one-shot `fireSubAgentCheckInNudge` against the SSE store
 * so tests can drive the fold; production nudges are `run.nudged` on the
 * server journal (P8-E).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  fireSubAgentCheckInNudge,
  initSubAgentCompletionPush,
  resetSubAgentCompletionPushForTests,
  setSubAgentCompletionDeliverHook,
} from '../../src/agents/sub-agent-completion-push.ts';
import {
  adoptSubAgentRunForTests,
  getSubAgentRun,
  resetSubAgentOrchestrator,
} from '../../src/agents/orchestrator.ts';
import { resetSubAgentConfigCache, setRuntimeSubAgentOverrides } from '../../src/agents/sub-agent-config.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat } from '../../src/types.ts';
import type { SubAgentRun } from '../../src/agents/types.ts';
import { FIXED_RUN_ID } from './test-helpers.mts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function makeBuildChat(): Chat {
  return {
    id: CHAT_ID,
    name: 'build',
    workspacePath: '',
    modeId: 'build',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
  };
}

function seedRunningRun(): SubAgentRun {
  const run: SubAgentRun = {
    runId: FIXED_RUN_ID,
    type: 'explore',
    task: 'slow',
    status: 'running',
    parentChatId: CHAT_ID,
    parentToolCallId: null,
    parentTurnId: 'turn-1',
    summary: '',
    error: null,
    startedAt: '2026-05-19T12:00:00.000Z',
    endedAt: null,
    toolTurns: 0,
    cancelled: false,
    messages: [],
  };
  adoptSubAgentRunForTests(run);
  return run;
}

describe('sub-agent check-in nudge', () => {
  const messages: string[] = [];

  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentCompletionPushForTests();
    messages.length = 0;
    setSessionStateForTests({
      version: 2,
      activeId: CHAT_ID,
      chats: [makeBuildChat()],
    });
    setSubAgentCompletionDeliverHook(async (_chatId, message) => {
      messages.push(message);
    });
    initSubAgentCompletionPush();
  });

  test('checkInNudgeMs 0 does not schedule automatic nudge delivery', async () => {
    setRuntimeSubAgentOverrides({ checkInNudgeMs: 0 });
    seedRunningRun();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(messages.filter((m) => m.includes('check-in')).length, 0);
  });

  test('one nudge before completion when run is still active', async () => {
    setRuntimeSubAgentOverrides({ checkInNudgeMs: 0 });
    seedRunningRun();
    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.ok(run);
    assert.equal(run.status, 'running');
    await fireSubAgentCheckInNudge(FIXED_RUN_ID);
    assert.equal(messages.filter((m) => m.includes('check-in')).length, 1);
    await fireSubAgentCheckInNudge(FIXED_RUN_ID);
    assert.equal(messages.filter((m) => m.includes('check-in')).length, 1);
  });
});
