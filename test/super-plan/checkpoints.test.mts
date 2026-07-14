/**
 * Super Plan checkpoint pausing tests (blocked_user at spec_confirm and present).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getSuperPlanCheckpointKind,
  isSuperPlanBlocked,
  resumeSuperPlanAfterUser,
  resetSuperPlanControllerForTests,
} from '../../src/chat/super-plan/controller.ts';
import {
  createInitialSuperPlanStages,
  createSuperPlanState,
  markSuperPlanStageStatus,
} from '../../src/chat/super-plan/state.ts';
import { createEmptyChatObject } from '../../src/state/sessions.ts';

function chatWithBlockedStage(
  stage: 'spec_confirm' | 'present',
): ReturnType<typeof createEmptyChatObject> {
  const chat = createEmptyChatObject('sp-checkpoint');
  chat.modeId = 'super-plan';
  chat.superPlan = createSuperPlanState('Add OAuth login');
  chat.superPlan.stages = createInitialSuperPlanStages();
  chat.superPlan.activeStage = stage;
  markSuperPlanStageStatus(chat, stage, 'blocked_user', {
    artifactPath:
      stage === 'spec_confirm'
        ? chat.superPlan.specPath
        : chat.superPlan.planPath,
  });
  return chat;
}

describe('Super Plan checkpoints', () => {
  test.after(() => {
    resetSuperPlanControllerForTests();
  });

  test('isSuperPlanBlocked and getSuperPlanCheckpointKind at spec_confirm', () => {
    const chat = chatWithBlockedStage('spec_confirm');
    assert.equal(isSuperPlanBlocked(chat), true);
    assert.equal(getSuperPlanCheckpointKind(chat), 'spec_confirm');
  });

  test('isSuperPlanBlocked and getSuperPlanCheckpointKind at present', () => {
    const chat = chatWithBlockedStage('present');
    assert.equal(isSuperPlanBlocked(chat), true);
    assert.equal(getSuperPlanCheckpointKind(chat), 'present');
  });

  test('resumeSuperPlanAfterUser confirm advances from spec_confirm to research', async () => {
    const chat = chatWithBlockedStage('spec_confirm');
    await resumeSuperPlanAfterUser(chat, 'confirm');
    assert.equal(chat.superPlan!.stages.spec_confirm.status, 'done');
    assert.equal(chat.superPlan!.activeStage, 'research');
  });

  test('resumeSuperPlanAfterUser revise clears spec_confirm checkpoint', async () => {
    const chat = chatWithBlockedStage('spec_confirm');
    await resumeSuperPlanAfterUser(chat, 'revise');
    assert.notEqual(chat.superPlan!.stages.spec_confirm.status, 'blocked_user');
    assert.equal(chat.superPlan!.activeStage, 'spec_confirm');
  });

  test('resumeSuperPlanAfterUser confirm at present marks stage done', async () => {
    const chat = chatWithBlockedStage('present');
    await resumeSuperPlanAfterUser(chat, 'confirm');
    assert.equal(chat.superPlan!.stages.present.status, 'done');
  });
});
