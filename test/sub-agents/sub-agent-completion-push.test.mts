/**
 * Sub-agent completion push: coalesced delivery when parent is idle.
 *
 * Seeds the SSE store (P8-G). The test handle is a memory journal so
 * ingest + tick still cover MIN-639 coalesce / retry / notify.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { emitSubAgentRunUpdated } from '../../src/agents/sub-agent-events.ts';
import {
  flushSubAgentCompletionPushForChat,
  initSubAgentCompletionPush,
  resetSubAgentCompletionPushForTests,
  setSubAgentCompletionDeliverHook,
  setSubAgentCompletionNotifyHook,
} from '../../src/agents/sub-agent-completion-push.ts';
import { streamingChatIds } from '../../src/app-state.ts';
import {
  adoptSubAgentRunForTests,
  getSubAgentRun,
  resetSubAgentOrchestrator,
} from '../../src/agents/orchestrator.ts';
import { resetSubAgentConfigCache } from '../../src/agents/sub-agent-config.ts';
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

function seedCompletedRun(): SubAgentRun {
  const run: SubAgentRun = {
    runId: FIXED_RUN_ID,
    type: 'explore',
    task: 'scan',
    status: 'completed',
    parentChatId: CHAT_ID,
    parentToolCallId: null,
    parentTurnId: 'turn-1',
    summary: 'FIXED_SUMMARY',
    error: null,
    startedAt: '2026-05-19T12:00:00.000Z',
    endedAt: '2026-05-19T12:00:01.000Z',
    toolTurns: 0,
    cancelled: false,
    messages: [],
  };
  adoptSubAgentRunForTests(run);
  return run;
}

describe('sub-agent completion push', () => {
  const deliveries: Array<{ chatId: string; message: string; runIds: string[] }> = [];
  const notified: Array<{ chatId: string; runId: string }> = [];

  beforeEach(() => {
    streamingChatIds.clear();
    notified.length = 0;
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentCompletionPushForTests();
    deliveries.length = 0;
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

  test('delivers one coalesced resume when run settles and parent is idle', async () => {
    seedCompletedRun();
    await flushSubAgentCompletionPushForChat(CHAT_ID);

    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.chatId, CHAT_ID);
    assert.ok(deliveries[0]?.message.includes('FIXED_SUMMARY'));
    assert.deepEqual(deliveries[0]?.runIds, [FIXED_RUN_ID]);
  });

  test('does not duplicate delivery for the same run', async () => {
    seedCompletedRun();
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

    seedCompletedRun();
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 0);

    fail = false;
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0]?.runIds, [FIXED_RUN_ID]);
  });

  test('delivers after the parent stream ends rather than dropping (MIN-639)', async () => {
    streamingChatIds.add(CHAT_ID);
    seedCompletedRun();
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 0);

    streamingChatIds.delete(CHAT_ID);
    await flushSubAgentCompletionPushForChat(CHAT_ID);

    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0]?.runIds, [FIXED_RUN_ID]);
  });

  test('notifies when the parent chat is gone instead of silence (MIN-639)', async () => {
    streamingChatIds.add(CHAT_ID);
    seedCompletedRun();
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
    seedCompletedRun();
    await flushSubAgentCompletionPushForChat(CHAT_ID);
    assert.equal(deliveries.length, 0);
  });
});
