/**
 * Super Plan pipeline helpers — stage skipping and next-stage resolution from config.
 */

import type { SuperPlanConfig } from '../../config/super-plan-meta';
import { nextSuperPlanStage, type SuperPlanStageId } from './types';

function reviewStageIndex(stageId: SuperPlanStageId): number | null {
  if (stageId === 'draft1' || stageId === 'review1') return 1;
  if (stageId === 'draft2' || stageId === 'review2') return 2;
  return null;
}

/** Whether a pipeline stage should be skipped for the given config. */
export function shouldSkipSuperPlanStage(
  stageId: SuperPlanStageId,
  config: SuperPlanConfig,
): boolean {
  const reviewIndex = reviewStageIndex(stageId);
  if (reviewIndex != null) {
    return reviewIndex > config.reviewRounds;
  }

  if (stageId === 'impeccable' && config.impeccable === 'never') {
    return true;
  }

  return false;
}

/** Next runnable stage after `stage`, skipping disabled stages. */
export function nextRunnableSuperPlanStage(
  stage: SuperPlanStageId,
  config: SuperPlanConfig,
): SuperPlanStageId | null {
  let next = nextSuperPlanStage(stage);
  while (next && shouldSkipSuperPlanStage(next, config)) {
    next = nextSuperPlanStage(next);
  }
  return next;
}

/** Map review stage id to pass number (1-based). */
export function superPlanReviewPassForStage(stageId: SuperPlanStageId): 1 | 2 | null {
  if (stageId === 'review1') return 1;
  if (stageId === 'review2') return 2;
  return null;
}

/** Map draft stage id to pass number (1-based). */
export function superPlanDraftPassForStage(stageId: SuperPlanStageId): 1 | 2 | null {
  if (stageId === 'draft1') return 1;
  if (stageId === 'draft2') return 2;
  return null;
}

/** Whether Impeccable should run (config + optional UI signal). */
export function shouldRunSuperPlanImpeccable(
  config: SuperPlanConfig,
  uiInvolved: boolean,
): boolean {
  if (config.impeccable === 'never') return false;
  if (config.impeccable === 'always') return true;
  return uiInvolved;
}
