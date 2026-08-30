/**
 * P9-B / P9-A / P9-G — the board surface, as DOM.
 *
 * The property under test is the one the whole phase is built around: **a card's
 * column is derived**. There is no drop handler, no status write, and no way for
 * this view to put a card anywhere the fold did not put it — so the tests assert
 * the mapping and assert that the writes on the page are commands.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import { derive } from '../../server/orchestrator/core/derive.js';
import type { BoardState } from '../../server/orchestrator/core/types';
import { bucketWave, columnOf, isBlocked } from '../../src/orchestrator/board-columns.ts';
import {
  renderBoardSkeleton,
  renderEngineErrors,
  renderFinishReport,
  renderTaskDetail,
  renderTaskList,
  type BoardActions,
} from '../../src/orchestrator/board-render.ts';

let activeWindow: Window | undefined;

function setupDom(): void {
  activeWindow?.close();
  const win = new Window();
  activeWindow = win;
  installHappyDomGlobals(win);
}

afterEach(() => {
  // The column-mapping tests are pure and never mount a DOM, so there may be
  // no `document` to clear.
  if (activeWindow) document.body.innerHTML = '';
  activeWindow?.close();
  activeWindow = undefined;
});

const NO_ACTIONS: BoardActions = {
  startTask: () => {},
  abandonTask: () => {},
  select: () => {},
  openTranscript: () => {},
};

const OPTIONS = { selectedTaskId: null, pendingTaskIds: new Set<string>() };

/** A board with W1-A merged, W1-B building, W1-C depending on an unmerged W1-B. */
function board(extra: Record<string, unknown>[] = []): BoardState {
  return derive([
    {
      v: 1,
      seq: 1,
      type: 'board.created',
      boardId: 'b1',
      planPath: 'documentation/plans/x.md',
      name: 'Example',
      waves: [{ n: 1, name: 'Foundations' }],
      tasks: [
        { id: 'W1-A', title: 'A', wave: 1, dependsOn: [], touches: ['a.ts'] },
        { id: 'W1-B', title: 'B', wave: 1, dependsOn: [], touches: ['b.ts'] },
        { id: 'W1-C', title: 'C', wave: 1, dependsOn: ['W1-B'], touches: ['c.ts'] },
        { id: 'W1-D', title: 'D', wave: 1, dependsOn: [], touches: ['d.ts'] },
      ],
    },
    { v: 1, seq: 2, type: 'board.started', concurrency: 2 },
    {
      v: 1,
      seq: 3,
      type: 'task.attempt.started',
      taskId: 'W1-A',
      attemptId: 'a1',
      role: 'builder',
    },
    {
      v: 1,
      seq: 4,
      type: 'task.attempt.ended',
      taskId: 'W1-A',
      attemptId: 'a1',
      role: 'builder',
      outcome: 'pass',
    },
    { v: 1, seq: 5, type: 'merge.enqueued', taskId: 'W1-A' },
    { v: 1, seq: 6, type: 'merge.succeeded', taskId: 'W1-A', sha: 'abc123' },
    {
      v: 1,
      seq: 7,
      type: 'task.attempt.started',
      taskId: 'W1-B',
      attemptId: 'b1',
      role: 'builder',
    },
    ...extra,
  ]);
}

describe('column mapping', () => {
  test('every phase lands in exactly one column', () => {
    const state = board();
    assert.equal(columnOf(state, state.tasks.get('W1-A')!), 'complete');
    assert.equal(columnOf(state, state.tasks.get('W1-B')!), 'in_progress');
    assert.equal(columnOf(state, state.tasks.get('W1-C')!), 'planned');
    assert.equal(columnOf(state, state.tasks.get('W1-D')!), 'planned');
  });

  test('a testing attempt is its own column, and merging is not', () => {
    const state = board([
      {
        v: 1,
        seq: 8,
        type: 'task.attempt.started',
        taskId: 'W1-D',
        attemptId: 'd1',
        role: 'tester',
      },
    ]);
    assert.equal(columnOf(state, state.tasks.get('W1-D')!), 'testing');
    // `merging` is in-flight work, not a fourth state: V1 grouped it with
    // In Progress and so does this.
    assert.equal(columnOf(state, state.tasks.get('W1-B')!), 'in_progress');
  });

  test('abandoned and skipped share Complete with merged', () => {
    const state = board([
      { v: 1, seq: 8, type: 'task.abandoned', taskId: 'W1-D', reason: 'user' },
    ]);
    assert.equal(columnOf(state, state.tasks.get('W1-D')!), 'complete');
    assert.equal(columnOf(state, state.tasks.get('W1-A')!), 'complete');
  });

  test('Blocked is a Planned task whose dependency has not merged', () => {
    const state = board();
    assert.equal(isBlocked(state, state.tasks.get('W1-C')!), true, 'C waits on B');
    assert.equal(isBlocked(state, state.tasks.get('W1-D')!), false, 'D waits on nothing');
    // Not a separate column — a card cannot be in two places.
    assert.equal(columnOf(state, state.tasks.get('W1-C')!), 'planned');
  });

  test('bucketWave keeps every column, empty ones included', () => {
    const state = board();
    const buckets = bucketWave(state, state.taskOrder);
    assert.deepEqual([...buckets.keys()], ['planned', 'in_progress', 'testing', 'complete']);
    assert.deepEqual(buckets.get('testing'), []);
    assert.deepEqual(
      buckets.get('planned')!.map((t) => t.id),
      ['W1-C', 'W1-D'],
    );
  });
});

describe('renderTaskList', () => {
  test('renders one kanban grid per wave, with four lanes', () => {
    setupDom();
    const node = renderTaskList(board(), NO_ACTIONS, OPTIONS);
    const grids = node.querySelectorAll('.ov2-kanban');
    assert.equal(grids.length, 1);
    assert.deepEqual(
      [...grids[0]!.querySelectorAll('.ov2-col')].map((c) => (c as HTMLElement).dataset.column),
      ['planned', 'in_progress', 'testing', 'complete'],
    );
  });

  test('puts each card in the column the fold implies', () => {
    setupDom();
    const node = renderTaskList(board(), NO_ACTIONS, OPTIONS);
    const columnOfCard = (id: string) =>
      (node
        .querySelector(`[data-task-id="${id}"]`)
        ?.closest('.ov2-col') as HTMLElement | null)?.dataset.column;
    assert.equal(columnOfCard('W1-A'), 'complete');
    assert.equal(columnOfCard('W1-B'), 'in_progress');
    assert.equal(columnOfCard('W1-C'), 'planned');
  });

  test('has no drag affordance at all', () => {
    // V1's drop handler wrote a status. There is no status to write here, so
    // there must be nothing that looks like it can be dragged.
    setupDom();
    const node = renderTaskList(board(), NO_ACTIONS, OPTIONS);
    assert.equal(node.querySelectorAll('[draggable="true"]').length, 0);
    assert.equal(node.querySelectorAll('[data-drop-target]').length, 0);
  });

  test('says what a blocked card is waiting for', () => {
    setupDom();
    const node = renderTaskList(board(), NO_ACTIONS, OPTIONS);
    const card = node.querySelector('[data-task-id="W1-C"]')!;
    assert.equal(card.classList.contains('ov2-task--blocked'), true);
    assert.match(card.querySelector('.ov2-task__blocked')!.textContent!, /W1-B/);
  });

  test('a card that has failed offers Retry, not Start', () => {
    setupDom();
    const state = board([
      {
        v: 1,
        seq: 8,
        type: 'task.attempt.ended',
        taskId: 'W1-B',
        attemptId: 'b1',
        role: 'builder',
        outcome: 'fail',
      },
    ]);
    const node = renderTaskList(state, NO_ACTIONS, OPTIONS);
    const card = node.querySelector('[data-task-id="W1-B"]')!;
    const labels = [...card.querySelectorAll('button')].map((b) => b.textContent);
    assert.ok(labels.includes('Retry'), `expected Retry, got ${labels.join(', ')}`);
  });

  test('Abandon is offered on live work and refused on finished work', () => {
    setupDom();
    const node = renderTaskList(board(), NO_ACTIONS, OPTIONS);
    const abandonIn = (id: string) =>
      node.querySelector<HTMLButtonElement>(
        `[data-task-id="${id}"] [data-focus-key="abandon:${id}"]`,
      )!;
    assert.equal(abandonIn('W1-B').disabled, false, 'a building task can be abandoned');
    assert.equal(abandonIn('W1-A').disabled, true, 'a merged task cannot');
  });

  test('every card carries a focus key that survives a repaint', () => {
    setupDom();
    const node = renderTaskList(board(), NO_ACTIONS, OPTIONS);
    const keys = [...node.querySelectorAll('.ov2-task__head')].map(
      (h) => (h as HTMLElement).dataset.focusKey,
    );
    assert.deepEqual(keys, ['task:W1-C', 'task:W1-D', 'task:W1-B', 'task:W1-A']);
  });
});

describe('renderEngineErrors (P9-A)', () => {
  test('renders nothing when nothing is failing', () => {
    setupDom();
    assert.equal(renderEngineErrors(new Map()), null);
    assert.equal(renderEngineErrors(undefined), null);
  });

  test('shows the message and how long it has been going', () => {
    setupDom();
    const node = renderEngineErrors(
      new Map([
        [
          'builder:W1-B',
          {
            taskId: 'W1-B',
            role: 'builder',
            message: 'no model bound for this attempt',
            consecutive: 40,
          },
        ],
      ]),
    )!;
    assert.equal(node.getAttribute('role'), 'alert');
    assert.match(node.textContent!, /no model bound for this attempt/);
    assert.match(node.textContent!, /W1-B/);
    assert.match(node.textContent!, /40 ticks in a row/);
  });

  test('one block per piece of work, not one per tick', () => {
    setupDom();
    const node = renderEngineErrors(
      new Map([
        ['builder:W1-B', { taskId: 'W1-B', role: 'builder', message: 'x', consecutive: 9 }],
      ]),
    )!;
    assert.equal(node.querySelectorAll('.ov2-errors__item').length, 1);
  });
});

describe('renderFinishReport (P9-G)', () => {
  test('is absent while the run is still going', () => {
    setupDom();
    assert.equal(renderFinishReport(board()), null);
  });

  test('reports per-task outcomes, attempt counts and why', () => {
    setupDom();
    const state = board([
      { v: 1, seq: 8, type: 'task.abandoned', taskId: 'W1-D', reason: 'builder-failed-twice' },
      { v: 1, seq: 9, type: 'task.skipped', taskId: 'W1-C', blockedBy: 'W1-D' },
      { v: 1, seq: 10, type: 'final.test.ended', outcome: 'pass', runInstructions: 'npm test' },
      { v: 1, seq: 11, type: 'run.finished', summary: '1 merged, 1 abandoned, 1 skipped' },
    ]);
    const node = renderFinishReport(state)!;
    const text = node.textContent!;
    assert.match(text, /1 merged, 1 abandoned, 1 skipped/);
    assert.match(text, /builder-failed-twice/);
    assert.match(text, /stranded by W1-D/);
    assert.match(text, /npm test/);
    assert.match(text, /abc123/, 'the integration sha is part of the report');
    assert.equal(node.querySelectorAll('.ov2-report__task').length, 4);
  });

  test('names a hand abandonment as one', () => {
    setupDom();
    const state = board([
      { v: 1, seq: 8, type: 'task.abandoned', taskId: 'W1-D', reason: 'user' },
      { v: 1, seq: 9, type: 'run.finished', summary: 'done' },
    ]);
    assert.match(renderFinishReport(state)!.textContent!, /abandoned by hand/);
  });
});

describe('renderTaskDetail (P9-D)', () => {
  test('offers a log for agent attempts and not for synthesised merges', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, OPTIONS);
    const opens = [...node.querySelectorAll('.ov2-attempt__open')].map(
      (b) => (b as HTMLElement).dataset.focusKey,
    );
    // W1-A ran one builder (a1) and has one merge attempt the fold synthesised.
    assert.deepEqual(opens, ['transcript:a1']);
  });

  test('renders a loading transcript as a skeleton, not as a word', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, {
      ...OPTIONS,
      transcript: {
        attemptId: 'a1',
        status: 'loading',
        events: [],
        truncated: false,
        capped: false,
      },
    });
    assert.ok(node.querySelector('.ov2-transcript__skeleton'));
    assert.equal(node.querySelector('.ov2-transcript__list'), null);
  });

  test('renders transcript entries, and says when it was capped', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, {
      ...OPTIONS,
      transcript: {
        attemptId: 'a1',
        status: 'ready',
        events: [{ type: 'tool_call', name: 'read_file', arguments: '{"path":"a.ts"}' }],
        truncated: false,
        capped: true,
      },
    });
    assert.match(node.textContent!, /read_file/);
    assert.match(node.textContent!, /more than the transcript keeps/);
  });

  test('an empty transcript says so rather than showing nothing', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, {
      ...OPTIONS,
      transcript: {
        attemptId: 'a1',
        status: 'ready',
        events: [],
        truncated: false,
        capped: false,
      },
    });
    assert.match(node.textContent!, /Nothing was recorded/);
  });
});

describe('loading states (P9-I)', () => {
  test('the board skeleton announces itself without animating', () => {
    setupDom();
    const node = renderBoardSkeleton();
    assert.equal(node.querySelector('[role="status"]')!.textContent, 'Loading the board');
    // The skeleton itself is decoration and must not be read out line by line.
    assert.equal(node.querySelector('.ov2-skeleton')!.getAttribute('aria-hidden'), 'true');
    assert.ok(node.querySelectorAll('.ov2-skeleton__line').length > 0);
  });
});
