/**
 * Super Plan config defaults, parsing, and pipeline integration (Phase 6).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_SUPER_PLAN_CONFIG,
  getSuperPlanConfigSync,
  getSuperPlanReviewPasses,
  resetSuperPlanConfigCache,
  resolveSuperPlanResearchMaxRounds,
  saveSuperPlanConfig,
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
      grillEnabled: true,
      researchEnabled: true,
      grillQuestionBudget: 20,
      impeccable: 'auto',
      researchScope: 'both',
      researchMaxRounds: 0,
      researchDepth: 'auto',
      researchModel: { providerId: '', modelId: '' },
      reviewerModel: { providerId: '', modelId: '' },
      plannerModel: { providerId: '', modelId: '' },
      reviewTimeoutMs: 20 * 60 * 1000,
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
  test('one review round keeps draft2 (applies review1 critique) but skips review2', () => {
    const config = { ...DEFAULT_SUPER_PLAN_CONFIG, reviewRounds: 1 };
    assert.equal(shouldSkipSuperPlanStage('review1', config), false);
    assert.equal(shouldSkipSuperPlanStage('draft2', config), false);
    assert.equal(shouldSkipSuperPlanStage('review2', config), true);
  });

  test('zero review rounds still drafts the plan once', () => {
    const config = { ...DEFAULT_SUPER_PLAN_CONFIG, reviewRounds: 0 };
    assert.equal(shouldSkipSuperPlanStage('draft1', config), false);
    assert.equal(shouldSkipSuperPlanStage('review1', config), true);
    assert.equal(shouldSkipSuperPlanStage('draft2', config), true);
    assert.equal(shouldSkipSuperPlanStage('review2', config), true);
    assert.equal(nextRunnableSuperPlanStage('draft1', config), 'impeccable');
  });

  test('nextRunnableSuperPlanStage jumps from draft2 to impeccable when one round', () => {
    const config = { ...DEFAULT_SUPER_PLAN_CONFIG, reviewRounds: 1 };
    assert.equal(nextRunnableSuperPlanStage('review1', config), 'draft2');
    assert.equal(nextRunnableSuperPlanStage('draft2', config), 'impeccable');
  });

  test('grill and research stages can be disabled via config', () => {
    const config = {
      ...DEFAULT_SUPER_PLAN_CONFIG,
      grillEnabled: false,
      researchEnabled: false,
    };
    assert.equal(shouldSkipSuperPlanStage('grill', config), true);
    assert.equal(shouldSkipSuperPlanStage('research', config), true);
    assert.equal(nextRunnableSuperPlanStage('spec_confirm', config), 'draft1');
    assert.equal(shouldSkipSuperPlanStage('grill', DEFAULT_SUPER_PLAN_CONFIG), false);
    assert.equal(shouldSkipSuperPlanStage('research', DEFAULT_SUPER_PLAN_CONFIG), false);
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

describe('saveSuperPlanConfig cache', () => {
  test('updates getSuperPlanConfigSync before the promise settles', () => {
    resetSuperPlanConfigCache();
    setSuperPlanConfigForTests({ ...DEFAULT_SUPER_PLAN_CONFIG });

    void saveSuperPlanConfig({ grillQuestionBudget: 12 }).catch(() => {
      /* server fetch may fail in unit tests; sync cache is what we assert */
    });

    assert.equal(getSuperPlanConfigSync().grillQuestionBudget, 12);
    assert.equal(getSuperPlanConfigSync().grillEnabled, true);
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
