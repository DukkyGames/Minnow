import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  cancelSubAgent,
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
import type { SubAgentRunner } from '../../src/agents/types.ts';

function slotHoldingRunner(): SubAgentRunner {
  return {
    async run(input) {
      input.onMessagesChange?.([
        { role: 'system', content: 'mock' },
        { role: 'user', content: input.task },
      ]);
      await new Promise<void>((_resolve, reject) => {
        const signal = input.signal;
        if (!signal) {
          reject(new Error('cancelled'));
          return;
        }
        if (signal.aborted) {
          reject(signal.reason ?? new Error('cancelled'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(signal.reason ?? new Error('cancelled')),
          { once: true },
        );
      });
      return {
        summary: 'never',
        toolTurns: 0,
        messages: [],
      };
    },
  };
}

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
    await waitForSubAgent(second.runId);

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

    for (let i = 0; i < 100; i += 1) {
      const mid = getSubAgentRun(FIXED_RUN_ID);
      if (mid && mid.messages.length >= 2) break;
      await new Promise((r) => setTimeout(r, 20));
    }
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

  test('queued run is not cancelled by timeout while waiting for a concurrency slot', async () => {
    setRuntimeSubAgentOverrides({ globalMaxConcurrent: 1, defaultTimeoutMs: 60_000 });
    setSubAgentRunnerFactory(() => slotHoldingRunner());

    const first = await spawnSubAgent({
      type: 'explore',
      task: 'hold slot',
      wait: false,
    });
    const second = await spawnSubAgent({
      type: 'explore',
      task: 'queued behind first',
      wait: false,
    });

    assert.equal(first.status, 'running');
    assert.equal(second.status, 'queued');

    await new Promise((r) => setTimeout(r, 500));

    const queued = getSubAgentRun(second.runId);
    assert.equal(queued?.status, 'queued');
    assert.notEqual(queued?.error, 'timeout');

    cancelSubAgent(first.runId, 'test cleanup');
    cancelSubAgent(second.runId, 'test cleanup');
  });
});
