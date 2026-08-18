/**
 * One-level sub-issue constraint and parent rollup.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  nestSubIssues,
  subIssueRollup,
  validateParentLink,
} from '../../src/issues/hierarchy.ts';
import { createDefaultIssuesTaxonomy } from '../../src/issues/taxonomy.ts';
import type { IssueCard } from '../../src/types.ts';

function card(
  partial: Partial<IssueCard> & Pick<IssueCard, 'id' | 'title' | 'status'>,
): IssueCard {
  return {
    type: 'task',
    description: '',
    priority: 'none',
    labels: [],
    workspacePath: '/w',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...partial,
  };
}

const taxonomy = createDefaultIssuesTaxonomy();

describe('issue hierarchy', () => {
  test('rejects self-parent, missing parent, and two-level trees', () => {
    const parent = card({ id: 'ISS-1', title: 'P', status: 'todo' });
    const child = card({ id: 'ISS-2', title: 'C', status: 'todo', parentId: 'ISS-1' });
    const issues = [parent, child];

    assert.equal(validateParentLink('ISS-1', 'ISS-1', issues).ok, false);
    assert.equal(validateParentLink('ISS-3', 'ISS-9', issues).ok, false);
    assert.equal(validateParentLink('ISS-3', 'ISS-2', issues).ok, false);
    assert.equal(validateParentLink('ISS-1', 'ISS-4', [...issues, card({ id: 'ISS-4', title: 'X', status: 'todo' })]).ok, false);
    assert.equal(validateParentLink('ISS-3', 'ISS-1', issues).ok, true);
  });

  test('rollup counts closed children as done', () => {
    const parent = card({ id: 'ISS-1', title: 'P', status: 'todo' });
    const open = card({ id: 'ISS-2', title: 'Open', status: 'todo', parentId: 'ISS-1' });
    const closed = card({ id: 'ISS-3', title: 'Done', status: 'done', parentId: 'ISS-1' });
    const rollup = subIssueRollup('ISS-1', [parent, open, closed], taxonomy);
    assert.deepEqual(rollup, { done: 1, total: 2 });
  });

  test('nestSubIssues keeps orphans top-level when the parent is not visible', () => {
    const parent = card({ id: 'ISS-1', title: 'P', status: 'todo' });
    const child = card({ id: 'ISS-2', title: 'C', status: 'todo', parentId: 'ISS-1' });
    const nested = nestSubIssues([child], [parent, child], taxonomy);
    assert.equal(nested.length, 1);
    assert.equal(nested[0].issue.id, 'ISS-2');
    assert.equal(nested[0].depth, 0);
  });
});
