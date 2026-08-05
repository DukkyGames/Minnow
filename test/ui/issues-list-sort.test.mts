/**
 * Issues list column sort: defaults, toggle, and compare order.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ariaSortValue,
  cycleIssuesListSort,
  defaultDirectionForSortKey,
  DEFAULT_ISSUES_LIST_SORT,
  sortIssuesForList,
  type IssuesListSort,
} from '../../src/ui/issues-list-sort.ts';
import type { IssueCard } from '../../src/types.ts';

function makeIssue(partial: Partial<IssueCard> & Pick<IssueCard, 'id' | 'title'>): IssueCard {
  return {
    type: 'task',
    description: '',
    status: 'todo',
    priority: 'none',
    labels: [],
    workspacePath: '/w',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...partial,
  };
}

describe('issues-list-sort', () => {
  test('default sort is updated descending', () => {
    assert.deepEqual(DEFAULT_ISSUES_LIST_SORT, { key: 'updated', direction: 'desc' });
  });

  test('defaultDirectionForSortKey prefers newest / highest for time and priority', () => {
    assert.equal(defaultDirectionForSortKey('updated'), 'desc');
    assert.equal(defaultDirectionForSortKey('priority'), 'desc');
    assert.equal(defaultDirectionForSortKey('title'), 'asc');
    assert.equal(defaultDirectionForSortKey('id'), 'asc');
  });

  test('cycleIssuesListSort toggles same column and resets direction on new column', () => {
    const current: IssuesListSort = { key: 'title', direction: 'asc' };
    assert.deepEqual(cycleIssuesListSort(current, 'title'), {
      key: 'title',
      direction: 'desc',
    });
    assert.deepEqual(cycleIssuesListSort(current, 'priority'), {
      key: 'priority',
      direction: 'desc',
    });
  });

  test('sortIssuesForList sorts by title ascending then toggles to descending', () => {
    const issues = [
      makeIssue({ id: 'ISS-1', title: 'Charlie', updatedAt: 3 }),
      makeIssue({ id: 'ISS-2', title: 'alpha', updatedAt: 2 }),
      makeIssue({ id: 'ISS-3', title: 'Bravo', updatedAt: 1 }),
    ];
    const asc = sortIssuesForList(issues, { key: 'title', direction: 'asc' });
    assert.deepEqual(
      asc.map((row) => row.id),
      ['ISS-2', 'ISS-3', 'ISS-1'],
    );
    const desc = sortIssuesForList(issues, { key: 'title', direction: 'desc' });
    assert.deepEqual(
      desc.map((row) => row.id),
      ['ISS-1', 'ISS-3', 'ISS-2'],
    );
  });

  test('sortIssuesForList sorts priority urgent-first when descending', () => {
    const issues = [
      makeIssue({ id: 'ISS-1', title: 'a', priority: 'low' }),
      makeIssue({ id: 'ISS-2', title: 'b', priority: 'urgent' }),
      makeIssue({ id: 'ISS-3', title: 'c', priority: 'medium' }),
    ];
    const sorted = sortIssuesForList(issues, { key: 'priority', direction: 'desc' });
    assert.deepEqual(
      sorted.map((row) => row.id),
      ['ISS-2', 'ISS-3', 'ISS-1'],
    );
  });

  test('sortIssuesForList sorts numeric issue ids across prefixes', () => {
    const issues = [
      makeIssue({ id: 'MIN-10', title: 'ten' }),
      makeIssue({ id: 'MIN-2', title: 'two' }),
      makeIssue({ id: 'MIN-1', title: 'one' }),
      makeIssue({ id: 'ISS-9', title: 'legacy' }),
    ];
    const sorted = sortIssuesForList(issues, { key: 'id', direction: 'asc' });
    assert.deepEqual(
      sorted.map((row) => row.id),
      ['ISS-9', 'MIN-1', 'MIN-2', 'MIN-10'],
    );
  });

  test('sortIssuesForList sorts numeric issue ids (ISS)', () => {
    const issues = [
      makeIssue({ id: 'ISS-10', title: 'ten' }),
      makeIssue({ id: 'ISS-2', title: 'two' }),
      makeIssue({ id: 'ISS-1', title: 'one' }),
    ];
    const sorted = sortIssuesForList(issues, { key: 'id', direction: 'asc' });
    assert.deepEqual(
      sorted.map((row) => row.id),
      ['ISS-1', 'ISS-2', 'ISS-10'],
    );
  });

  test('sortIssuesForList sorts status by workflow order', () => {
    const issues = [
      makeIssue({ id: 'ISS-1', title: 'a', status: 'done' }),
      makeIssue({ id: 'ISS-2', title: 'b', status: 'triage' }),
      makeIssue({ id: 'ISS-3', title: 'c', status: 'in_progress' }),
    ];
    const sorted = sortIssuesForList(issues, { key: 'status', direction: 'asc' });
    assert.deepEqual(
      sorted.map((row) => row.id),
      ['ISS-2', 'ISS-3', 'ISS-1'],
    );
  });

  test('ariaSortValue marks only the active column', () => {
    const sort: IssuesListSort = { key: 'updated', direction: 'desc' };
    assert.equal(ariaSortValue(sort, 'updated'), 'descending');
    assert.equal(ariaSortValue(sort, 'title'), 'none');
  });
});
