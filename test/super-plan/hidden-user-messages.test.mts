/**
 * Super Plan controller user rows stay in history but hide from the transcript.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isSuperPlanPipelineUserMessage,
  superPlanPipelineUserMessage,
} from '../../src/chat/super-plan/hidden-user-messages.ts';

describe('super plan hidden user messages', () => {
  test('stamped rows are treated as pipeline prompts', () => {
    const row = superPlanPipelineUserMessage('Super Plan pipeline — **Grill stage**.', 'grill');
    assert.equal(isSuperPlanPipelineUserMessage(row), true);
    assert.equal(row.superPlanStage, 'grill');
  });

  test('legacy rows without a stamp match the pipeline prefix', () => {
    assert.equal(
      isSuperPlanPipelineUserMessage({
        role: 'user',
        content: 'Super Plan pipeline — **Build spec stage**.\nWrite the build specification…',
      }),
      true,
    );
  });

  test('normal user rows are not hidden', () => {
    assert.equal(
      isSuperPlanPipelineUserMessage({
        role: 'user',
        content: 'lets make a three.js website for a drone service company',
      }),
      false,
    );
  });
});
