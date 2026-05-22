/**
 * Orchestrator spawn hook updates board task to in_progress.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const TASK_ID = 'W1-A';
const PLAN_PATH = 'documentation/plans/test-plan.md';

const { setSessionStateForTests, createEmptyChatObject, findChatById } = await import(
  '../../src/state/sessions.ts'
);
const { initBoard } = await import('../../src/state/orchestrate-board-store.ts');
const { spawnSubAgent, resetSubAgentOrchestrator } = await import(
  '../../src/agents/orchestrator.ts'
);
const { resetSubAgentConfigCache, setRuntimeSubAgentOverrides } = await import(
  '../../src/agents/sub-agent-config.ts'
);
const {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} = await import('../../src/agents/sub-agent-run-id.ts');
const {
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} = await import('../../src/agents/sub-agent-runner.ts');
const { FIXED_RUN_ID } = await import('../sub-agents/test-helpers.mts');
const { createMockSubAgentRunner } = await import('../sub-agents/test-helpers.mts');

function seedChat() {
  const chat = createEmptyChatObject('');
  chat.id = FIXED_CHAT_ID;
  chat.modeId = 'orchestrate';
  chat.orchestratePlanPath = PLAN_PATH;
  initBoard(chat, {
    planPath: PLAN_PATH,
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

describe('orchestrator board link', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 50 }));
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    setRuntimeSubAgentOverrides({ globalMaxConcurrent: 3 });
    seedChat();
  });

  test('spawn with board_task_id sets task in_progress', async () => {
    const result = await spawnSubAgent({
      type: 'explore',
      task: 'Build task A',
      wait: false,
      parentChatId: FIXED_CHAT_ID,
      parentTurnId: 'turn-board-link-1',
      modeId: 'orchestrate',
      category: 'build',
      boardTaskId: TASK_ID,
    });
    assert.equal(result.runId, FIXED_RUN_ID);
    const chat = findChatById(FIXED_CHAT_ID);
    const task = chat?.orchestrateBoard?.tasks.find((t) => t.id === TASK_ID);
    assert.equal(task?.status, 'in_progress');
    assert.equal(task?.assignedRunId, FIXED_RUN_ID);
    assert.deepEqual(task?.runHistory, [FIXED_RUN_ID]);
  });
});
