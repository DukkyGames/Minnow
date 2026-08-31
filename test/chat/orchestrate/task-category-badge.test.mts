/**
 * Task category badge derivation (presentation; MIN-714 moved out of orchestrate/).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveTaskCategoryBadge } from '../../../src/orchestrator/task-category-badge.ts';
import type { LeftoverBoardTask } from '../../../src/types.ts';

function baseTask(overrides: Partial<LeftoverBoardTask> = {}): LeftoverBoardTask {
  return {
    id: 'W1-A',
    title: 'Task A',
    wave: 'W1',
    category: 'build',
    status: 'planned',
    ...overrides,
  };
}

describe('deriveTaskCategoryBadge', () => {
  test('uses the plan-authored category for the chip', () => {
    const badge = deriveTaskCategoryBadge(
      baseTask({ status: 'in_progress' }),
    );
    assert.deepEqual(badge, { label: 'build', cssVariant: 'build' });
  });

  test('does not rewrite category after failed testing (V1 fix-chip is gone)', () => {
    const badge = deriveTaskCategoryBadge(
      baseTask({ status: 'in_progress' }),
    );
    assert.deepEqual(badge, { label: 'build', cssVariant: 'build' });
  });
});
