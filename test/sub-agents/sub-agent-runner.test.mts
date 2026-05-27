/**
 * Sub-agent runner respects per-run maxToolTurns and reports exhaustion.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  defaultSubAgentRunner,
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} from '../../src/agents/sub-agent-runner.ts';
import type { SubAgentRunner } from '../../src/agents/types.ts';

/** Mock runner that always requests another tool round until capped. */
function createExhaustingRunner(): SubAgentRunner {
  return {
    async run(input) {
      let toolTurns = 0;
      const maxToolTurns = Math.max(1, input.maxToolTurns);

      for (let turn = 0; turn < maxToolTurns; turn++) {
        toolTurns += 1;
        if (turn + 1 >= maxToolTurns) {
          return {
            summary: `Sub-agent reached maximum tool turns (${maxToolTurns}).`,
            toolTurns,
            messages: [],
            toolTurnLimitExhausted: true,
          };
        }
      }

      return { summary: 'unexpected', toolTurns, messages: [] };
    },
  };
}

describe('sub-agent runner maxToolTurns', () => {
  beforeEach(() => {
    resetSubAgentRunnerFactory();
  });

  test('defaultSubAgentRunner accepts maxToolTurns from input', async () => {
    setSubAgentRunnerFactory(() => createExhaustingRunner());

    const out = await createExhaustingRunner().run({
      runId: 'run-1',
      type: 'explore',
      task: 'task',
      systemPrompt: 'sys',
      tools: [],
      providerId: 'lm-studio-local',
      modelId: '',
      maxToolTurns: 3,
      signal: AbortSignal.timeout(1000),
      executeTool: async () => ({ content: 'ok' }),
    });

    assert.equal(out.toolTurns, 3);
    assert.equal(out.toolTurnLimitExhausted, true);
    assert.match(out.summary, /maximum tool turns \(3\)/);
  });

  test('orchestrator passes merged global maxToolTurns to runner', async () => {
    const limits: number[] = [];
    setSubAgentRunnerFactory(() => ({
      async run(input) {
        limits.push(input.maxToolTurns);
        return {
          summary: 'done',
          toolTurns: 1,
          messages: [],
        };
      },
    }));

    const { spawnSubAgent, resetSubAgentOrchestrator } = await import(
      '../../src/agents/orchestrator.ts'
    );
    const { getSubAgentsMaxToolTurns, loadSubAgentConfig, resetSubAgentConfigCache } =
      await import('../../src/agents/sub-agent-config.ts');
    const { resetSubAgentRunIdFactory, setSubAgentRunIdFactory } = await import(
      '../../src/agents/sub-agent-run-id.ts'
    );
    const { FIXED_RUN_ID } = await import('./test-helpers.mts');

    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunIdFactory();
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);

    const cfg = await loadSubAgentConfig();
    const expectedMax = getSubAgentsMaxToolTurns(cfg);

    await spawnSubAgent({
      type: 'generalPurpose',
      task: 'multi-step',
      wait: true,
      parentTurnId: 'turn-limit',
      modeId: 'orchestrate',
    });

    assert.deepEqual(limits, [expectedMax]);

    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    setSubAgentRunnerFactory(() => defaultSubAgentRunner);
  });
});
