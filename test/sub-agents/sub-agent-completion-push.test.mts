/**
 * Sub-agent completion push: coalesced delivery when parent is idle.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { emitSubAgentRunUpdated } from '../../src/agents/sub-agent-events.ts';
import {
  flushAllPendingSubAgentCompletions,
  flushSubAgentCompletionPushForChat,
  initSubAgentCompletionPush,
  resetSubAgentCompletionPushForTests,
  setSubAgentCompletionDeliverHook,
  setSubAgentCompletionNotifyHook,
} from '../../src/agents/sub-agent-completion-push.ts';
import { streamingChatIds } from '../../src/app-state.ts';
import { resetSubAgentOrchestrator, waitForSubAgent } from '../../src/agents/orchestrator.ts';
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

describe('sub-agent completion push', () => {
  const deliveries: Array<{ chatId: string; message: string; runIds: string[] }> = [];
  const notified: Array<{ chatId: string; runId: string }> = [];

  beforeEach(() => {
    streamingChatIds.clear();
    notified.length = 0;
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
    setSubAgentCompletionNotifyHook((chatId, run) => {
      notified.push({ chatId, runId: run.runId });
    });
    initSubAgentCompletionPush();
  });

  /** Settle one background run against CHAT_ID and return its run id. */
  async function settleRun(): Promise<string> {
    const { spawnSubAgent } = await import('../../src/agents/orchestrator.ts');
    await spawnSubAgent({
      type: 'explore',
      task: 'scan',
      wait: false,
      parentChatId: CHAT_ID,
      parentTurnId: 'turn-1',
      modeId: 'build',
    });
    await waitForSubAgent(FIXED_RUN_ID);
    return FIXED_RUN_ID;
  }

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
    await waitForSubAgent(FIXED_RUN_ID);
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
    await waitForSubAgent(FIXED_RUN_ID);
    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.ok(run);
    emitSubAgentRunUpdated(run);
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 1);
  });

  test('keeps a failed delivery queued instead of dropping it (MIN-639)', async () => {
    let fail = true;
    setSubAgentCompletionDeliverHook(async (chatId, message, runIds) => {
      if (fail) throw new Error('resume blew up');
      deliveries.push({ chatId, message, runIds: [...runIds] });
    });

    await settleRun();
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 0);

    // The run must still be queued — a non-transport failure used to delete it.
    fail = false;
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0]?.runIds, [FIXED_RUN_ID]);
  });

  test('delivers after the parent stream ends rather than dropping (MIN-639)', async () => {
    streamingChatIds.add(CHAT_ID);
    await settleRun();
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 0);

    // Stream ended silently; the chat-switch drain is the backstop.
    streamingChatIds.delete(CHAT_ID);
    flushAllPendingSubAgentCompletions();
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0]?.runIds, [FIXED_RUN_ID]);
  });

  test('notifies when the parent chat is gone instead of silence (MIN-639)', async () => {
    streamingChatIds.add(CHAT_ID);
    await settleRun();
    streamingChatIds.delete(CHAT_ID);
    setSessionStateForTests({ version: 2, activeId: null, chats: [] });

    await flushSubAgentCompletionPushForChat(CHAT_ID);

    assert.equal(deliveries.length, 0);
    assert.deepEqual(notified, [{ chatId: CHAT_ID, runId: FIXED_RUN_ID }]);
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
