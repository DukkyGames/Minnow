/**
 * MIN-15 / MIN-10: max tool turns must fail the run and not complete the board task.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { resetSubAgentOrchestrator, spawnSubAgent } from '../../src/agents/orchestrator.ts';
import { resetSubAgentConfigCache } from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import {
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} from '../../src/agents/sub-agent-runner.ts';
import type { SubAgentRunner } from '../../src/agents/types.ts';
import { buildSubAgentStatusPayload } from '../../src/agents/orchestrator.ts';
import { getOrCreateBoardGroup } from '../../src/state/chat-groups.ts';
import {
  executeSubAgentTool,
  setSubAgentExecutorContext,
} from '../../src/tools/sub-agent-executor.ts';
import {
  createEmptyChatObject,
  findChatById,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { FIXED_RUN_ID } from './test-helpers.mts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const TASK_ID = 'W1-A';
const PLAN_PATH = 'documentation/plans/test-plan.md';

const exhaustingRunner: SubAgentRunner = {
  async run() {
    return {
      summary: 'Sub-agent reached maximum tool turns (4).',
      toolTurns: 4,
      messages: [],
      toolTurnLimitExhausted: true,
    };
  },
};

function seedChat() {
  const chat = createEmptyChatObject('');
  chat.id = FIXED_CHAT_ID;
  chat.modeId = 'orchestrate';
  chat.orchestratePlanPath = PLAN_PATH;
  setSessionStateForTests({
    version: 5,
    activeId: chat.id,
    chats: [chat],
  });
  const group = getOrCreateBoardGroup(chat);
  // Leftover session blob only — V2 boards are journals and this run does not write them.
  group.orchestrateBoard = {
    planPath: PLAN_PATH,
    startedAt: 1,
    lastUpdatedAt: 1,
    waves: [{ id: 'W1' }],
    tasks: [{ id: TASK_ID, title: 'Task A', wave: 'W1', category: 'build', status: 'planned' }],
  };
}

describe('sub-agent tool turn exhaustion', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    setSubAgentRunnerFactory(() => exhaustingRunner);
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    seedChat();
  });

  test('spawn wait marks run failed and board task stays failed', async () => {
    const result = await spawnSubAgent({
      type: 'explore',
      task: 'scaffold many files',
      wait: true,
      parentChatId: FIXED_CHAT_ID,
      parentTurnId: 'turn-exhaust',
      modeId: 'orchestrate',
      boardTaskId: TASK_ID,
    });

    assert.equal('status' in result ? result.status : '', 'failed');
    if ('error' in result && result.error) {
      assert.match(result.error, /maximum tool turns/i);
    }

    const chat = findChatById(FIXED_CHAT_ID);
    assert.ok(chat);
    const group = getOrCreateBoardGroup(chat);
    const task = group.orchestrateBoard?.tasks.find((t) => t.id === TASK_ID);
    // Sub-agents do not mutate leftover V1 cards; the run failing is the signal.
    assert.notEqual(task?.status, 'complete');
  });

  test('get_sub_agent_status reports success false after max turns', async () => {
    await spawnSubAgent({
      type: 'explore',
      task: 'scaffold many files',
      wait: true,
      parentChatId: FIXED_CHAT_ID,
      parentTurnId: 'turn-status',
      modeId: 'orchestrate',
      boardTaskId: TASK_ID,
    });

    setSubAgentExecutorContext({
      parentTurnId: 'turn-status',
      modeId: 'orchestrate',
      parentChatId: FIXED_CHAT_ID,
    });

    const statusOut = await executeSubAgentTool('get_sub_agent_status', {
      run_id: FIXED_RUN_ID,
    });
    const body = JSON.parse(statusOut) as {
      status: string;
      success: boolean;
      error?: string;
      summary: string;
    };
    assert.equal(body.status, 'failed');
    assert.equal(body.success, false);
    assert.match(body.summary, /maximum tool turns/i);
    if (body.error) {
      assert.match(body.error, /maximum tool turns/i);
    }
  });

  test('buildSubAgentStatusPayload never marks max-turn summary as success', async () => {
    const { getSubAgentRun } = await import('../../src/agents/orchestrator.ts');
    await spawnSubAgent({
      type: 'explore',
      task: 'scaffold',
      wait: true,
      parentChatId: FIXED_CHAT_ID,
      parentTurnId: 'turn-payload',
      modeId: 'orchestrate',
    });
    const run = getSubAgentRun(FIXED_RUN_ID);
    assert.ok(run);
    const payload = buildSubAgentStatusPayload(run);
    assert.equal(payload.success, false);
    assert.equal(payload.status, 'failed');
  });
});
