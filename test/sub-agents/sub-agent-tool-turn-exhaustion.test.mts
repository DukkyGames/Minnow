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
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import {
  createEmptyChatObject,
  findChatById,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { FIXED_RUN_ID } from './test-helpers.mts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const TASK_ID = 'W1-A';

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
  initBoard(chat, {
    planPath: 'documentation/plans/test-plan.md',
    tasks: [{ id: TASK_ID, title: 'Task A', wave: 'W1', category: 'build' }],
    waves: [{ id: 'W1' }],
  });
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
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
    setRuntimeSubAgentOverrides({
      types: { explore: { maxToolTurns: 4 } },
    });
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
    const task = chat?.orchestrateBoard?.tasks.find((t) => t.id === TASK_ID);
    assert.equal(task?.status, 'failed');
    assert.notEqual(task?.status, 'complete');
  });
});
