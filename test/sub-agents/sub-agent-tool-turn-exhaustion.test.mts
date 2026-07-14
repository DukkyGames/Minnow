/**
 * MIN-15 / MIN-10: max tool turns must fail the run and not complete the board task.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { resetSubAgentOrchestrator, spawnSubAgent } from '../../src/agents/orchestrator.ts';
import { resetSubAgentConfigCache, setRuntimeSubAgentOverrides } from '../../src/agents/sub-agent-config.ts';
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
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
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
  async run(input) {
    return {
      summary: `Sub-agent reached maximum tool turns (${input.maxToolTurns}).`,
      toolTurns: input.maxToolTurns,
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
  initBoard(group, chat, {
    planPath: PLAN_PATH,
    tasks: [{ id: TASK_ID, title: 'Task A', wave: 'W1', category: 'build' }],
    waves: [{ id: 'W1' }],
  });
}

describe('sub-agent tool turn exhaustion', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    setSubAgentRunnerFactory(() => exhaustingRunner);
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    setRuntimeSubAgentOverrides({ maxToolTurns: 4 });
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
    assert.equal(task?.status, 'failed');
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
