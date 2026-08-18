/**
 * Issues list grouping: rank wins, session sort is the fallback, nesting follows parent.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildGroupedIssueRows,
  groupIssuesForList,
  sortIssuesInGroup,
} from '../../src/issues/grouping.ts';
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
const sessionSort = { key: 'title' as const, direction: 'asc' as const };

describe('issues grouping', () => {
  test('group by status omits empty buckets', () => {
    const issues = [
      card({ id: 'ISS-1', title: 'Alpha', status: 'todo' }),
      card({ id: 'ISS-2', title: 'Beta', status: 'todo' }),
    ];
    const groups = groupIssuesForList(issues, 'status', { taxonomy, projects: [] });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, 'status:todo');
    assert.equal(groups[0].issues.length, 2);
  });

  test('rank wins over session column sort inside a group', () => {
    const issues = [
      card({ id: 'ISS-1', title: 'A', status: 'todo', rank: 'm' }),
      card({ id: 'ISS-2', title: 'B', status: 'todo', rank: 'a' }),
      card({ id: 'ISS-3', title: 'C', status: 'todo' }),
    ];
    const sorted = sortIssuesInGroup(issues, sessionSort, taxonomy);
    assert.deepEqual(
      sorted.map((issue) => issue.id),
      ['ISS-2', 'ISS-1', 'ISS-3'],
    );
  });

  test('a visible parent nests its child even when statuses differ', () => {
    const parent = card({ id: 'ISS-1', title: 'Parent', status: 'todo' });
    const child = card({ id: 'ISS-2', title: 'Child', status: 'backlog', parentId: 'ISS-1' });
    const grouped = buildGroupedIssueRows([parent, child], 'status', sessionSort, {
      taxonomy,
      projects: [],
      allIssues: [parent, child],
    });
    const todo = grouped.find((group) => group.id === 'status:todo');
    const backlog = grouped.find((group) => group.id === 'status:backlog');
    assert.ok(todo);
    assert.equal(todo?.rows.length, 1);
    assert.equal(todo?.rows[0].issue.id, 'ISS-1');
    assert.equal(todo?.rows[0].children[0]?.id, 'ISS-2');
    assert.equal(backlog, undefined);
  });

  test('a child whose parent is filtered out stays a top-level row', () => {
    const parent = card({ id: 'ISS-1', title: 'Parent', status: 'done' });
    const child = card({ id: 'ISS-2', title: 'Child', status: 'todo', parentId: 'ISS-1' });
    const grouped = buildGroupedIssueRows([child], 'status', sessionSort, {
      taxonomy,
      projects: [],
      allIssues: [parent, child],
    });
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].rows[0].issue.id, 'ISS-2');
    assert.equal(grouped[0].rows[0].children.length, 0);
  });
});
