import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { progressStageToStep } from '../../src/superplan/progress-panel.ts';
import type { SuperPlanStage } from '../../src/superplan/types.ts';

describe('superplan types / progress mapping', () => {
  test('progressStageToStep maps pipeline stages to stepper indices', () => {
    const cases: Array<[SuperPlanStage | undefined, number]> = [
      ['intake', 0],
      ['spec', 1],
      ['research', 2],
      ['draft1', 3],
      ['review1', 4],
      ['draft2', 5],
      ['review2', 6],
      ['impeccable', 7],
      ['finalize', 8],
      ['done', 8],
      ['error', 0],
      [undefined, 0],
    ];

    for (const [stage, expected] of cases) {
      assert.equal(progressStageToStep(stage), expected, String(stage));
    }
  });
});
