import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getBoardScenario } from '../../src/dev/orchestrate-scenarios/catalog.ts';
import {
  DEFAULT_PERSISTED_RESTART_CHECKPOINTS,
  createBoardGateDriver,
} from '../orchestrate/persisted/gate-adapter.mts';

describe('persisted board gate adapter', () => {
  test('declares practical process and active-board restart checkpoints', () => {
    assert.deepEqual(DEFAULT_PERSISTED_RESTART_CHECKPOINTS, [
      'after-server-ready',
      'after-fake-model-start',
      'after-board-seed',
      'after-worktree-create',
      'after_board_start',
    ]);
  });

  test('classifies unsupported semantic checkpoints as harness_error', async () => {
    const scenario = getBoardScenario('happy.quick');
    assert.ok(scenario);
    const driver = await createBoardGateDriver({
      gate: 'restart',
      scenario,
      checkpoints: ['during_merge'],
    });
    const result = await driver.runIteration({
      seed: 513,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      scenario: {
        ...scenario,
        gate: { kind: 'restart', checkpoints: ['during_merge'] },
      },
    });
    assert.equal(result.classification, 'harness_error');
    assert.match(result.error, /Unsupported persisted restart checkpoint.*during_merge/);
    assert.deepEqual(result.finalState.unsupportedCheckpoints, ['during_merge']);
  });
});
