/**
 * Configurable check-in nudge while sub-agents run (non-orchestrate).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  fireSubAgentCheckInNudge,
  initSubAgentCompletionPush,
  resetSubAgentCompletionPushForTests,
  setSubAgentCompletionDeliverHook,
} from '../../src/agents/sub-agent-completion-push.ts';
import { getSubAgentRun, resetSubAgentOrchestrator, spawnSubAgent } from '../../src/agents/orchestrator.ts';
import { resetSubAgentConfigCache, setRuntimeSubAgentOverrides } from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import {
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} from '../../src/agents/sub-agent-runner.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import type { Chat } from '../../src/types.ts';
import {
  createMockSubAgentRunner,
  FIXED_RUN_ID,
  resetRunIdCounter,
} from './test-helpers.mts';

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

describe('sub-agent check-in nudge', () => {
  const messages: string[] = [];

  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    resetRunIdCounter();
    resetSubAgentCompletionPushForTests();
    messages.length = 0;
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
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
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 80 }));
    await spawnSubAgent({
      type: 'explore',
      task: 'slow',
      wait: false,
      parentChatId: CHAT_ID,
      parentTurnId: 'turn-1',
      modeId: 'build',
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(messages.filter((m) => m.includes('check-in')).length, 0);
  });

  test('one nudge before completion when run is still active', async () => {
    setRuntimeSubAgentOverrides({ checkInNudgeMs: 30 });
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 200 }));
    await spawnSubAgent({
      type: 'explore',
      task: 'slow',
      wait: false,
      parentChatId: CHAT_ID,
      parentTurnId: 'turn-1',
      modeId: 'build',
    });
    await new Promise((r) => setTimeout(r, 40));
    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.ok(run);
    assert.equal(run.status, 'running');
    fireSubAgentCheckInNudge(FIXED_RUN_ID);
    assert.equal(messages.filter((m) => m.includes('check-in')).length, 1);
    fireSubAgentCheckInNudge(FIXED_RUN_ID);
    assert.equal(messages.filter((m) => m.includes('check-in')).length, 1);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(getSubAgentRun(FIXED_RUN_ID)?.status, 'completed');
  });
});
