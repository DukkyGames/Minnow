/**
 * Super Plan pause/cancel/rework state transitions (controller + state helpers).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cancelSuperPlan,
  isSuperPlanStalled,
  pauseSuperPlan,
  resetSuperPlanControllerForTests,
} from '../../src/chat/super-plan/controller.ts';
import {
  createInitialSuperPlanStages,
  createSuperPlanState,
  markSuperPlanStageStatus,
  resetSuperPlanStage,
  rewindSuperPlanStages,
} from '../../src/chat/super-plan/state.ts';
import { createEmptyChatObject } from '../../src/state/sessions.ts';

function makeChat(activeStage: Parameters<typeof rewindSuperPlanStages>[1] = 'grill') {
  const chat = createEmptyChatObject('sp-lifecycle');
  chat.modeId = 'super-plan';
  chat.superPlan = createSuperPlanState('Add OAuth login');
  chat.superPlan.stages = createInitialSuperPlanStages();
  chat.superPlan.activeStage = activeStage;
  return chat;
}

describe('Super Plan stage reset', () => {
  test.after(() => resetSuperPlanControllerForTests());

  test('resetSuperPlanStage fully replaces the record (no stale error/artifact)', () => {
    const chat = makeChat('draft1');
    markSuperPlanStageStatus(chat, 'draft1', 'error', {
      error: 'boom',
      artifactPath: 'documentation/plans/x.md',
    });
    resetSuperPlanStage(chat, 'draft1');
    const record = chat.superPlan!.stages.draft1;
    assert.equal(record.status, 'pending');
    assert.equal(record.error, undefined);
    assert.equal(record.artifactPath, undefined);
    assert.equal(record.startedAt, undefined);
    assert.equal(record.finishedAt, undefined);
  });
});

describe('Super Plan rewind', () => {
  test('rewindSuperPlanStages resets the target and all later stages', () => {
    const chat = makeChat('finalize');
    for (const stage of ['grill', 'spec_confirm', 'research', 'draft1', 'review1'] as const) {
      markSuperPlanStageStatus(chat, stage, 'done');
    }
    chat.superPlan!.review1Critique = 'critique';
    chat.superPlan!.researchId = 'r-123';
    chat.superPlan!.paused = true;

    rewindSuperPlanStages(chat, 'draft1');

    const sp = chat.superPlan!;
    assert.equal(sp.activeStage, 'draft1');
    assert.equal(sp.paused, false);
    assert.equal(sp.stages.grill.status, 'done');
    assert.equal(sp.stages.research.status, 'done');
    assert.equal(sp.stages.draft1.status, 'pending');
    assert.equal(sp.stages.review1.status, 'pending');
    assert.equal(sp.stages.finalize.status, 'pending');
    assert.equal(sp.review1Critique, undefined);
    assert.equal(sp.researchId, 'r-123', 'rewind after research keeps the research run');
  });

  test('rewinding to research clears the stale research id', () => {
    const chat = makeChat('draft1');
    chat.superPlan!.researchId = 'r-123';
    rewindSuperPlanStages(chat, 'research');
    assert.equal(chat.superPlan!.researchId, undefined);
    assert.equal(chat.superPlan!.activeStage, 'research');
  });
});

describe('Super Plan pause and cancel', () => {
  test.after(() => resetSuperPlanControllerForTests());

  test('pauseSuperPlan marks the pipeline paused and stalled', () => {
    const chat = makeChat('draft1');
    markSuperPlanStageStatus(chat, 'draft1', 'running');
    pauseSuperPlan(chat);
    assert.equal(chat.superPlan!.paused, true);
    assert.equal(chat.superPlan!.cancelled, undefined);
    assert.equal(isSuperPlanStalled(chat), true);
  });

  test('cancelSuperPlan is terminal and marks the active stage', () => {
    const chat = makeChat('draft1');
    markSuperPlanStageStatus(chat, 'draft1', 'running');
    cancelSuperPlan(chat);
    assert.equal(chat.superPlan!.cancelled, true);
    assert.equal(chat.superPlan!.paused, false);
    assert.equal(chat.superPlan!.stages.draft1.status, 'error');
    assert.equal(chat.superPlan!.stages.draft1.error, 'Cancelled by user');
    assert.equal(isSuperPlanStalled(chat), false);
  });

  test('isSuperPlanStalled is false at user checkpoints and after completion', () => {
    const blocked = makeChat('spec_confirm');
    markSuperPlanStageStatus(blocked, 'spec_confirm', 'blocked_user');
    assert.equal(isSuperPlanStalled(blocked), false);

    const finished = makeChat('present');
    markSuperPlanStageStatus(finished, 'present', 'done');
    assert.equal(isSuperPlanStalled(finished), false);

    const errored = makeChat('research');
    markSuperPlanStageStatus(errored, 'research', 'error', { error: 'Research timed out' });
    assert.equal(isSuperPlanStalled(errored), true);
  });
});
