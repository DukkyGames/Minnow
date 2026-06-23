/**
 * Super Plan controller — stage sequencing, spec gate, and helpers.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { AggregateResult } from '../../src/agents/types.ts';
import { resetSubAgentOrchestrator } from '../../src/agents/orchestrator.ts';
import {
  resetSuperPlanControllerDepsForTests,
  setSuperPlanControllerDepsForTests,
  SuperPlanController,
} from '../../src/superplan/controller.ts';

resetSubAgentOrchestrator();
import {
  buildSpecSynthesisTask,
} from '../../src/superplan/prompts/index.ts';
import {
  resetFinalizeStageDepsForTests,
  setFinalizeStageDepsForTests,
} from '../../src/superplan/finalize-stage.ts';
import {
  parseQuestionnaireJson,
  planContainsCodeSnippets,
  superPlanStageToProgress,
} from '../../src/superplan/helpers.ts';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const SAMPLE_QUESTIONS_JSON = JSON.stringify({
  questions: [
    { id: 'goal', prompt: 'Primary goal?', kind: 'text' },
    {
      id: 'audience',
      prompt: 'Audience?',
      kind: 'single',
      options: ['Team', 'Solo'],
    },
  ],
});

const SAMPLE_SPEC = '# Build spec\n\nGoal: ship feature X.';

function aggregate(summary: string): AggregateResult {
  return {
    runId: 'run-test',
    type: 'generalPurpose',
    status: 'completed',
    summary,
    outcome: { schema: 'minnow.sub-agent.v1', payload: {} },
    startedAt: null,
    endedAt: null,
  };
}

async function waitForRunStatus(
  controller: SuperPlanController,
  status: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (controller.getRunState()?.status === status) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`Timed out waiting for status ${status}`);
}

describe('superplan helpers', () => {
  test('parseQuestionnaireJson extracts questions array', () => {
    const questions = parseQuestionnaireJson(SAMPLE_QUESTIONS_JSON);
    assert.equal(questions?.length, 2);
    assert.equal(questions?.[0]?.id, 'goal');
  });

  test('planContainsCodeSnippets detects fenced blocks', () => {
    assert.equal(planContainsCodeSnippets('## Plan\n\nNo code here.'), false);
    assert.equal(
      planContainsCodeSnippets('## Plan\n\n```ts\nconst x = 1;\n```'),
      true,
    );
  });

  test('superPlanStageToProgress maps stage and message', () => {
    const event = superPlanStageToProgress('research', 'Searching…');
    assert.equal(event.stage, 'research');
    assert.equal(event.message, 'Searching…');
  });
});

describe('SuperPlanController', () => {
  let spawnCalls: Array<{ type: string; task: string }>;
  let researchStarted = false;
  let chatId = '';

  beforeEach(() => {
    resetSubAgentOrchestrator();
    if (typeof globalThis.document === 'undefined') {
      globalThis.document = {
        getElementById: () => null,
      } as Document;
    }
    spawnCalls = [];
    researchStarted = false;

    const chat = createEmptyChatObject('test-model', '/workspace');
    chatId = chat.id;
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      chats: [chat],
      groups: [],
    });

    let spawnIndex = 0;
    const spawnResponses = [
      SAMPLE_QUESTIONS_JSON,
      SAMPLE_SPEC,
      SAMPLE_SPEC,
      'Plan saved to documentation/plans/superplan/super-test.md',
      '## Critical\nNone\n## Verdict\nAPPROVE',
      'Plan saved to documentation/plans/superplan/super-test-v2.md',
      '## Critical\nNone\n## Verdict\nAPPROVE',
      SAMPLE_SPEC,
      'Plan saved to documentation/plans/superplan/super-test-v2.md',
    ];

    setSuperPlanControllerDepsForTests({
      spawnSubAgent: async (input) => {
        spawnCalls.push({ type: input.type, task: input.task });
        const runId = `run-${spawnIndex}`;
        return { runId, status: 'running' };
      },
      waitForSubAgent: async () => {
        const summary = spawnResponses[spawnIndex] ?? 'done';
        spawnIndex += 1;
        return aggregate(summary);
      },
      startResearch: async () => {
        researchStarted = true;
        return { researchId: 'research-1' };
      },
      subscribeToResearchStream: (_id, handlers) => {
        queueMicrotask(() => {
          handlers.onEnd?.({ status: 'done', final: true });
        });
        return () => {};
      },
      fetchResearchResult: async () => ({
        result: 'Research brief content',
        sources: [],
      }),
      cancelResearch: async () => {},
      cancelSubAgent: () => ({ ok: true, runId: 'run-0', status: 'cancelled' }),
      executeTool: async () => ({ content: 'Saved.' }),
    });

    setFinalizeStageDepsForTests({
      executeTool: async () => ({ content: 'Saved.' }),
    });
  });

  afterEach(() => {
    resetSubAgentOrchestrator();
    resetSuperPlanControllerDepsForTests();
    resetFinalizeStageDepsForTests();
  });

  test('start generates intake questions via sub-agent', async () => {
    let intakeReady = false;
    const controller = new SuperPlanController(chatId, () => {}, {
      onIntakeReady: (questions) => {
        intakeReady = true;
        assert.equal(questions.length, 2);
      },
    });

    await controller.start('Build auth module');
    assert.equal(intakeReady, true);
    assert.equal(controller.getRunState()?.stage, 'intake');
    assert.equal(controller.getRunState()?.questionnaire?.length, 2);
  });

  test('stage sequencing reaches spec gate after intake answers', async () => {
    const progress: string[] = [];
    const controller = new SuperPlanController(chatId, (event) => {
      progress.push(event.stage);
    });

    await controller.start('Build auth module');
    void controller.submitIntakeAnswers({ goal: 'Auth', audience: 'Team' });
    await waitForRunStatus(controller, 'awaiting_user');

    assert.ok(spawnCalls.some((c) => c.type === 'generalPurpose'));
    assert.ok(spawnCalls.some((c) => c.type === 'plan-planner'));
    assert.ok(progress.includes('spec'));
    assert.equal(controller.getRunState()?.stage, 'spec');
  });

  test('spec gate pause until confirmSpec', async () => {
    const controller = new SuperPlanController(chatId, () => {});

    await controller.start('Feature');
    void controller.submitIntakeAnswers({ goal: 'x' });
    await waitForRunStatus(controller, 'awaiting_user');

    assert.equal(controller.getRunState()?.status, 'awaiting_user');
    assert.equal(researchStarted, false);

    controller.cancel();
  });

  test('reviseSpec builds revision notes into planner task', () => {
    const task = buildSpecSynthesisTask('Feature', '### goal\nAuth', 'Add mobile support');
    assert.ok(task.includes('Add mobile support'));
  });
});
