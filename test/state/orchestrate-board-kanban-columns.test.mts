/**
 * Kanban column layout when skip per-task testing is enabled.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  boardShowsTestingKanbanColumn,
  getKanbanColumnDefs,
} from '../../src/chat/orchestrate/board-kanban-columns.ts';
import type { OrchestrateBoardState } from '../../src/types.ts';

function makeBoard(
  overrides: Partial<OrchestrateBoardState> = {},
): OrchestrateBoardState {
  return {
    planPath: 'documentation/plans/test.md',
    tasks: [
      { id: 'W1-A', title: 'A', wave: 'W1', category: 'build', status: 'planned' },
    ],
    waves: [{ id: 'W1', status: 'planned' }],
    startedAt: 1,
    lastUpdatedAt: 1,
    ...overrides,
  };
}

describe('getKanbanColumnDefs', () => {
  test('default board has four lanes including Testing', () => {
    const cols = getKanbanColumnDefs(makeBoard());
    assert.equal(cols.length, 4);
    assert.equal(cols.some((c) => c.id === 'testing'), true);
  });

  test('skip on hides Testing when no task is in testing', () => {
    const board = makeBoard({ skipPerTaskTesting: true });
    assert.equal(boardShowsTestingKanbanColumn(board), false);
    const cols = getKanbanColumnDefs(board);
    assert.equal(cols.length, 3);
    assert.equal(cols.some((c) => c.id === 'testing'), false);
  });

  test('skip on keeps Testing lane when a legacy task is still in testing', () => {
    const board = makeBoard({
      skipPerTaskTesting: true,
      tasks: [
        {
          id: 'W1-A',
          title: 'A',
          wave: 'W1',
          category: 'build',
          status: 'testing',
        },
      ],
    });
    assert.equal(boardShowsTestingKanbanColumn(board), true);
    assert.equal(getKanbanColumnDefs(board).length, 4);
  });
});
