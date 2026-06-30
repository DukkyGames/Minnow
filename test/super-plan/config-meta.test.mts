/**
 * Super Plan config defaults, parsing, and pipeline integration (Phase 6).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_SUPER_PLAN_CONFIG,
  getSuperPlanReviewPasses,
  resetSuperPlanConfigCache,
  resolveSuperPlanResearchMaxRounds,
  setSuperPlanConfigForTests,
} from '../../src/config/super-plan-meta.ts';
import {
  nextRunnableSuperPlanStage,
  shouldRunSuperPlanImpeccable,
  shouldSkipSuperPlanStage,
} from '../../src/chat/super-plan/pipeline.ts';
import { buildPlanReviewerTask } from '../../src/chat/super-plan/review-helpers.ts';

describe('DEFAULT_SUPER_PLAN_CONFIG', () => {
  test('matches Phase 6 spec defaults', () => {
    assert.deepEqual(DEFAULT_SUPER_PLAN_CONFIG, {
      reviewRounds: 2,
      grillQuestionBudget: 20,
      impeccable: 'auto',
      researchScope: 'both',
      researchMaxRounds: 0,
      researchDepth: 'auto',
      researchModel: { providerId: '', modelId: '' },
      reviewerModel: { providerId: '', modelId: '' },
      plannerModel: { providerId: '', modelId: '' },
    });
  });
});

describe('resolveSuperPlanResearchMaxRounds', () => {
  test('explicit maxRounds wins over depth preset', () => {
    assert.equal(
      resolveSuperPlanResearchMaxRounds({
        ...DEFAULT_SUPER_PLAN_CONFIG,
        researchMaxRounds: 4,
        researchDepth: 'quick',
      }),
      4,
    );
  });

  test('depth presets when maxRounds is 0', () => {
    assert.equal(
      resolveSuperPlanResearchMaxRounds({
        ...DEFAULT_SUPER_PLAN_CONFIG,
        researchDepth: 'quick',
      }),
      2,
    );
    assert.equal(
      resolveSuperPlanResearchMaxRounds({
        ...DEFAULT_SUPER_PLAN_CONFIG,
        researchDepth: 'deep',
      }),
      5,
    );
    assert.equal(
      resolveSuperPlanResearchMaxRounds({
        ...DEFAULT_SUPER_PLAN_CONFIG,
        researchDepth: 'auto',
      }),
      0,
    );
  });
});

describe('pipeline stage skipping', () => {
  test('skips second review cycle when reviewRounds is 1', () => {
    const config = { ...DEFAULT_SUPER_PLAN_CONFIG, reviewRounds: 1 };
    assert.equal(shouldSkipSuperPlanStage('draft2', config), true);
    assert.equal(shouldSkipSuperPlanStage('review2', config), true);
    assert.equal(shouldSkipSuperPlanStage('review1', config), false);
  });

  test('nextRunnableSuperPlanStage jumps from review1 to impeccable when one round', () => {
    const config = { ...DEFAULT_SUPER_PLAN_CONFIG, reviewRounds: 1 };
    assert.equal(nextRunnableSuperPlanStage('review1', config), 'impeccable');
  });

  test('impeccable never when configured never', () => {
    const config = { ...DEFAULT_SUPER_PLAN_CONFIG, impeccable: 'never' as const };
    assert.equal(shouldSkipSuperPlanStage('impeccable', config), true);
    assert.equal(shouldRunSuperPlanImpeccable(config, true), false);
  });

  test('impeccable always when configured always', () => {
    const config = { ...DEFAULT_SUPER_PLAN_CONFIG, impeccable: 'always' as const };
    assert.equal(shouldRunSuperPlanImpeccable(config, false), true);
  });
});

describe('controller config accessors', () => {
  test('getSuperPlanReviewPasses reflects reviewRounds', () => {
    resetSuperPlanConfigCache();
    setSuperPlanConfigForTests({ ...DEFAULT_SUPER_PLAN_CONFIG, reviewRounds: 3 });
    assert.deepEqual(getSuperPlanReviewPasses({ ...DEFAULT_SUPER_PLAN_CONFIG, reviewRounds: 3 }), [
      1, 2, 3,
    ]);
  });

  test('buildPlanReviewerTask uses configured review round total', () => {
    const task = buildPlanReviewerTask({
      pass: 1,
      reviewRounds: 3,
      draftPlan: '# Plan',
    });
    assert.ok(task.includes('pass 1 of 3'));
  });
});
