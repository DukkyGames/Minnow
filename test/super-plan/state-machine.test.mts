/**
 * Super Plan state machine transition tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createInitialSuperPlanStages,
  createSuperPlanState,
  markSuperPlanStageStatus,
  setSuperPlanActiveStage,
} from '../../src/chat/super-plan/state.ts';
import {
  nextSuperPlanStage,
  SUPER_PLAN_STAGE_ORDER,
} from '../../src/chat/super-plan/types.ts';
import { createEmptyChatObject } from '../../src/state/sessions.ts';

describe('Super Plan stage order', () => {
  test('defines the full pipeline sequence', () => {
    assert.deepEqual(SUPER_PLAN_STAGE_ORDER, [
      'grill',
      'spec_confirm',
      'research',
      'draft1',
      'review1',
      'draft2',
      'review2',
      'impeccable',
      'finalize',
      'present',
    ]);
  });

  test('nextSuperPlanStage walks forward and stops at present', () => {
    assert.equal(nextSuperPlanStage('grill'), 'spec_confirm');
    assert.equal(nextSuperPlanStage('spec_confirm'), 'research');
    assert.equal(nextSuperPlanStage('present'), null);
  });
});

describe('Super Plan state helpers', () => {
  test('createSuperPlanState initializes pending stages and artifact paths', () => {
    const state = createSuperPlanState('Build a Kanban UI');
    assert.equal(state.activeStage, 'grill');
    assert.equal(state.stages.grill.status, 'pending');
    assert.match(state.slug, /kanban/);
    assert.equal(
      state.specPath,
      `documentation/plans/references/${state.slug}-spec.md`,
    );
    assert.equal(
      state.researchPath,
      `documentation/plans/references/${state.slug}-research.md`,
    );
    assert.equal(state.planPath, `documentation/plans/${state.slug}.md`);
  });

  test('markSuperPlanStageStatus records timestamps on transitions', () => {
    const chat = createEmptyChatObject('sp1');
    chat.superPlan = createSuperPlanState('Feature X');
    chat.superPlan.stages = createInitialSuperPlanStages();

    markSuperPlanStageStatus(chat, 'grill', 'running');
    assert.equal(chat.superPlan.stages.grill.status, 'running');
    assert.ok(chat.superPlan.stages.grill.startedAt);

    markSuperPlanStageStatus(chat, 'grill', 'done');
    assert.equal(chat.superPlan.stages.grill.status, 'done');
    assert.ok(chat.superPlan.stages.grill.finishedAt);

    setSuperPlanActiveStage(chat, 'spec_confirm');
    assert.equal(chat.superPlan.activeStage, 'spec_confirm');
  });
});
