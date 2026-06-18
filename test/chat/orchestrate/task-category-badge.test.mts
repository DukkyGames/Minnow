/**
 * Orchestrate task category badge derivation.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveTaskCategoryBadge } from '../../../src/chat/orchestrate/task-category-badge.ts';
import type { BoardTask } from '../../../src/types.ts';

function baseTask(overrides: Partial<BoardTask> = {}): BoardTask {
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
  test('build task in Run with no test failures shows build', () => {
    const badge = deriveTaskCategoryBadge(
      baseTask({ status: 'in_progress', testAttempts: 0 }),
    );
    assert.deepEqual(badge, { label: 'build', cssVariant: 'build' });
  });

  test('build task in Run after failed testing shows fix', () => {
    const badge = deriveTaskCategoryBadge(
      baseTask({ status: 'in_progress', testAttempts: 1 }),
    );
    assert.deepEqual(badge, { label: 'fix', cssVariant: 'fix' });
  });

  test('build task in Testing after failed attempt keeps build', () => {
    const badge = deriveTaskCategoryBadge(
      baseTask({ status: 'testing', testAttempts: 1 }),
    );
    assert.deepEqual(badge, { label: 'build', cssVariant: 'build' });
  });

  test('build task complete after retries keeps build', () => {
    const badge = deriveTaskCategoryBadge(
      baseTask({ status: 'complete', testAttempts: 2 }),
    );
    assert.deepEqual(badge, { label: 'build', cssVariant: 'build' });
  });
});
