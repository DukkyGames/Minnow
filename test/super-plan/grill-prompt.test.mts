/**
 * Super Plan grill stage prompt — batches of five ask_question cards.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SUPER_PLAN_GRILL_QUESTIONS_PER_BATCH,
  adaptGrillingSkillForSuperPlan,
  buildSuperPlanGrillStageUserText,
} from '../../src/chat/super-plan/grill-prompt.ts';

const GRILLING_SKILL_BODY = `Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a question can be answered by exploring the codebase, explore the codebase instead.
`;

describe('Super Plan grill prompt helpers', () => {
  test('SUPER_PLAN_GRILL_QUESTIONS_PER_BATCH is five', () => {
    assert.equal(SUPER_PLAN_GRILL_QUESTIONS_PER_BATCH, 5);
  });

  test('adaptGrillingSkillForSuperPlan swaps one-at-a-time for batching', () => {
    const adapted = adaptGrillingSkillForSuperPlan(GRILLING_SKILL_BODY);
    assert.ok(adapted);
    assert.match(adapted, /batches of up to 5/);
    assert.doesNotMatch(adapted, /one at a time/);
    assert.doesNotMatch(adapted, /bewildering/);
  });

  test('adaptGrillingSkillForSuperPlan leaves unknown bodies unchanged', () => {
    const custom = 'Ask whatever you want.';
    assert.equal(adaptGrillingSkillForSuperPlan(custom), custom);
  });

  test('buildSuperPlanGrillStageUserText requests batched ask_question calls', () => {
    const text = buildSuperPlanGrillStageUserText(20, 'Add OAuth login');
    assert.match(text, /batches of up to 5/);
    assert.match(text, /~20 design questions/);
    assert.match(text, /Add OAuth login/);
    assert.doesNotMatch(text, /one at a time/);
  });
});
