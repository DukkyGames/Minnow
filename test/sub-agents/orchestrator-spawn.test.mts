import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  getSubAgentRun,
  resetSubAgentOrchestrator,
  spawnSubAgent,
  waitForSubAgent,
} from '../../src/agents/orchestrator.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';
import { resetSubAgentConfigCache, setRuntimeSubAgentOverrides } from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import {
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} from '../../src/agents/sub-agent-runner.ts';
import {
  createMockSubAgentRunner,
  FIXED_RUN_ID,
  nextFixedRunId,
  resetRunIdCounter,
} from './test-helpers.mts';

describe('orchestrator spawn', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    resetRunIdCounter();
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 30 }));
    setSubAgentRunIdFactory(() => nextFixedRunId());
  });

  test('spawn returns runId and completes with mock runner', async () => {
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    const result = await spawnSubAgent({
      type: 'explore',
      task: 'find files',
      wait: true,
    });

    if (!('summary' in result)) {
      assert.fail('expected aggregate result');
    }
    assert.equal(result.runId, FIXED_RUN_ID);
    assert.equal(result.status, 'completed');
    assert.equal(result.summary, 'FIXED_SUMMARY');
  });

  test('respects globalMaxConcurrent and queues excess', async () => {
    setRuntimeSubAgentOverrides({ globalMaxConcurrent: 1 });
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 200 }));

    const first = await spawnSubAgent({
      type: 'explore',
      task: 'task one',
      wait: false,
    });
    const second = await spawnSubAgent({
      type: 'explore',
      task: 'task two',
      wait: false,
    });

    assert.equal(first.status, 'running');
    assert.equal(second.status, 'queued');

    const run2 = getSubAgentRun(second.runId);
    assert.equal(run2?.status, 'queued');
  });

  test('queued run starts after the first run finishes', async () => {
    setRuntimeSubAgentOverrides({ globalMaxConcurrent: 1 });
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 80 }));

    const first = await spawnSubAgent({
      type: 'explore',
      task: 'task one',
      wait: false,
    });
    const second = await spawnSubAgent({
      type: 'explore',
      task: 'task two',
      wait: false,
    });
    assert.equal(second.status, 'queued');

    await waitForSubAgent(first.runId);
    await new Promise((r) => setTimeout(r, 120));

    const run2 = getSubAgentRun(second.runId);
    assert.equal(run2?.status, 'completed');
  });

  test('inherits parent chat model when type modelId is empty', async () => {
    const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
    let capturedModelId = 'unset';
    const chat = createEmptyChatObject('');
    chat.id = FIXED_CHAT_ID;
    chat.modelId = 'parent-model-123';
    chat.providerId = 'lm-studio-local';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    setSubAgentRunnerFactory(() => ({
      async run(input) {
        capturedModelId = input.modelId;
        return createMockSubAgentRunner().run(input);
      },
    }));

    await spawnSubAgent({
      type: 'explore',
      task: 'find files',
      wait: true,
      parentChatId: FIXED_CHAT_ID,
      parentTurnId: 'turn-model-inherit-1',
    });

    assert.equal(capturedModelId, 'parent-model-123');
  });

  test('publishes transcript messages while the runner is in flight', async () => {
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    const waitPromise = spawnSubAgent({
      type: 'explore',
      task: 'live transcript task',
      wait: true,
    });

    await new Promise((r) => setTimeout(r, 5));
    const mid = getSubAgentRun(FIXED_RUN_ID);
    assert.ok(mid && mid.messages.length >= 2);
    assert.equal(mid?.messages[0]?.role, 'system');
    assert.equal(mid?.messages[1]?.role, 'user');

    const result = await waitPromise;
    if (!('summary' in result)) {
      assert.fail('expected aggregate result');
    }
    const done = getSubAgentRun(FIXED_RUN_ID);
    assert.ok(done && done.messages.some((m) => m.role === 'assistant'));
  });
});
