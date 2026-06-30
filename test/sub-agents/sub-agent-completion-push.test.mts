/**
 * Sub-agent completion push: coalesced delivery when parent is idle.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { emitSubAgentRunUpdated } from '../../src/agents/sub-agent-events.ts';
import {
  flushSubAgentCompletionPushForChat,
  initSubAgentCompletionPush,
  resetSubAgentCompletionPushForTests,
  setSubAgentCompletionDeliverHook,
} from '../../src/agents/sub-agent-completion-push.ts';
import { resetSubAgentOrchestrator } from '../../src/agents/orchestrator.ts';
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
  waitForSubAgentRunTerminal,
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

describe('sub-agent completion push', () => {
  const deliveries: Array<{ chatId: string; message: string; runIds: string[] }> = [];

  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    resetRunIdCounter();
    resetSubAgentCompletionPushForTests();
    deliveries.length = 0;
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 5 }));
    setSessionStateForTests({
      version: 2,
      activeId: CHAT_ID,
      chats: [makeBuildChat()],
    });
    setSubAgentCompletionDeliverHook(async (chatId, message, runIds) => {
      deliveries.push({ chatId, message, runIds: [...runIds] });
    });
    initSubAgentCompletionPush();
  });

  test('delivers one coalesced resume when run settles and parent is idle', async () => {
    const { spawnSubAgent } = await import('../../src/agents/orchestrator.ts');
    await spawnSubAgent({
      type: 'explore',
      task: 'scan',
      wait: false,
      parentChatId: CHAT_ID,
      parentTurnId: 'turn-1',
      modeId: 'build',
    });
    await waitForSubAgentRunTerminal(FIXED_RUN_ID);
    await flushSubAgentCompletionPushForChat(CHAT_ID);

    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.chatId, CHAT_ID);
    assert.ok(deliveries[0]?.message.includes('FIXED_SUMMARY'));
    assert.deepEqual(deliveries[0]?.runIds, [FIXED_RUN_ID]);
  });

  test('does not duplicate delivery for the same run', async () => {
    const { getSubAgentRun } = await import('../../src/agents/orchestrator.ts');
    const { spawnSubAgent } = await import('../../src/agents/orchestrator.ts');
    await spawnSubAgent({
      type: 'explore',
      task: 'scan',
      wait: false,
      parentChatId: CHAT_ID,
      parentTurnId: 'turn-1',
      modeId: 'build',
    });
    await waitForSubAgentRunTerminal(FIXED_RUN_ID);
    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.ok(run);
    emitSubAgentRunUpdated(run);
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 1);
  });

  test('skips push for orchestrate mode chats', async () => {
    setSessionStateForTests({
      version: 2,
      activeId: CHAT_ID,
      chats: [{ ...makeBuildChat(), modeId: 'orchestrate' }],
    });
    const { spawnSubAgent } = await import('../../src/agents/orchestrator.ts');
    await spawnSubAgent({
      type: 'explore',
      task: 'scan',
      wait: false,
      parentChatId: CHAT_ID,
      parentTurnId: 'turn-1',
      modeId: 'orchestrate',
    });
    await new Promise((r) => setTimeout(r, 30));
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 0);
  });
});
