/**
 * Suite scheduler matrix and concurrency tests (mock runner/grader).
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { setEvalRunnerFactory, resetEvalRunnerFactory } from '../../src/evals/runner.ts';
import { setEvalGraderFactory, resetEvalGraderFactory } from '../../src/evals/grader.ts';
import { subscribeEvalSuiteProgress } from '../../src/evals/eval-events.ts';
import { runEvalSuite } from '../../src/evals/suite-scheduler.ts';
import type { EvalPack } from '../../src/evals/types.ts';

const pack: EvalPack = {
  id: 'pack-11111111',
  label: 'Two tasks',
  version: 1,
  tasks: [
    {
      id: 'task-aaaa',
      prompt: 'A',
      allowedTools: [],
      deniedTools: [],
      rubricPrompt: 'JSON score',
    },
    {
      id: 'task-bbbb',
      prompt: 'B',
      allowedTools: [],
      deniedTools: [],
      rubricPrompt: 'JSON score',
    },
  ],
};

afterEach(() => {
  resetEvalRunnerFactory();
  resetEvalGraderFactory();
});

describe('runEvalSuite', () => {
  it('runs task×model matrix with mock runner', async () => {
    const events: string[] = [];
    const unsub = subscribeEvalSuiteProgress((ev) => {
      events.push(`${ev.completedCells}/${ev.totalCells}`);
    });

    setEvalRunnerFactory(() => ({
      async run() {
        return {
          summary: 'mock summary',
          toolTurns: 0,
          messages: [{ role: 'assistant', content: 'mock summary' }],
        };
      },
    }));

    setEvalGraderFactory(() => ({
      async grade() {
        return { score: 100, pass: true, rationale: 'mock' };
      },
    }));

    const suiteRunId = await runEvalSuite({
      request: {
        packId: pack.id,
        targets: [
          { providerId: 'lm-studio-local', modelId: 'test-model' },
          { providerId: 'lm-studio-local', modelId: 'other-model' },
        ],
        maxConcurrency: 2,
      },
      pack,
      fallbackProviderId: 'lm-studio-local',
      fallbackModelId: 'test-model',
      defaultWorkspacePath: '/workspace',
    });

    unsub();
    assert.match(suiteRunId, /^suite-/);
    assert.ok(events.some((e) => e === '4/4'));
  });
});
