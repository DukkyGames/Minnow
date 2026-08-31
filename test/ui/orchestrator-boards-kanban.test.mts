/**
 * P9-B / P9-A / P9-G — the board surface, as DOM.
 *
 * The property under test is the one the whole phase is built around: **a card's
 * column is derived**. There is no drop handler, no status write, and no way for
 * this view to put a card anywhere the fold did not put it — so the tests assert
 * the mapping and assert that the writes on the page are commands.
 */
// First, and before the renderer imports: the detail panel renders task specs
// through the assistant markdown pipeline, and `dompurify` builds its sanitizer
// against `globalThis.window` at module eval.
import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import { derive } from '../../server/orchestrator/core/derive.js';
import type { BoardState } from '../../server/orchestrator/core/types';
import { bucketWave, columnOf, isBlocked } from '../../src/orchestrator/board-columns.ts';
import {
  renderBoardHeader,
  renderBoardSkeleton,
  renderEngineErrors,
  renderRunLedger,
  renderTaskList,
  type BoardActions,
} from '../../src/orchestrator/board-render.ts';
import {
  renderTaskDetail,
  resetTaskDetailUi,
} from '../../src/orchestrator/task-detail.ts';

let activeWindow: Window | undefined;

function setupDom(): void {
  activeWindow?.close();
  const win = new Window();
  activeWindow = win;
  installHappyDomGlobals(win);
  // The detail panel remembers open disclosures across repaints, so each test
  // starts from the same place rather than from the last one's clicks.
  resetTaskDetailUi();
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
  rerun: () => {},
  select: () => {},
  openTranscript: () => {},
  toggleFileDiff: () => {},
  openFile: () => {},
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

  test('an abandoned task on a finished board offers enabled Retry', () => {
    setupDom();
    const state = derive([
      {
        v: 1,
        seq: 1,
        type: 'board.created',
        boardId: 'b1',
        planPath: 'p.md',
        name: 'Example',
        waves: [{ n: 1, name: 'One' }],
        tasks: [
          { id: 'W1-A', title: 'A', wave: 1, dependsOn: [], touches: ['a.ts'] },
          { id: 'W1-B', title: 'B', wave: 1, dependsOn: [], touches: ['b.ts'] },
        ],
      },
      { v: 1, seq: 2, type: 'merge.succeeded', taskId: 'W1-A', sha: 'abc123abc123' },
      { v: 1, seq: 3, type: 'task.abandoned', taskId: 'W1-B', reason: 'builder-failed-twice' },
      { v: 1, seq: 4, type: 'final.test.ended', outcome: 'fail' },
      { v: 1, seq: 5, type: 'run.finished', summary: 'blocked' },
      { v: 1, seq: 6, type: 'board.stopped', reason: 'terminal' },
    ]);
    const calls: string[][] = [];
    const actions: BoardActions = {
      ...NO_ACTIONS,
      rerun: (ids) => calls.push(ids ?? []),
    };
    const node = renderTaskList(state, actions, OPTIONS);
    const btn = node.querySelector<HTMLButtonElement>('[data-focus-key="start:W1-B"]')!;
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, 'Retry');
    btn.click();
    assert.deepEqual(calls, [['W1-B']]);
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

  test('selecting an already-open card does not toggle the overlay closed', () => {
    setupDom();
    const calls: Array<string | null> = [];
    const actions: BoardActions = {
      ...NO_ACTIONS,
      select: (id) => calls.push(id),
    };
    const node = renderTaskList(board(), actions, {
      selectedTaskId: 'W1-A',
      pendingTaskIds: new Set(),
    });
    node.querySelector<HTMLButtonElement>('[data-focus-key="task:W1-A"]')!.click();
    assert.deepEqual(calls, []);
    node.querySelector<HTMLButtonElement>('[data-focus-key="task:W1-B"]')!.click();
    assert.deepEqual(calls, ['W1-B']);
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

describe('renderRunLedger (P9-G)', () => {
  test('is absent while the run is still going', () => {
    setupDom();
    assert.equal(renderRunLedger(board()), null);
  });

  test('reports per-task outcomes, attempt counts and why', () => {
    setupDom();
    const state = board([
      { v: 1, seq: 8, type: 'task.abandoned', taskId: 'W1-D', reason: 'builder-failed-twice' },
      { v: 1, seq: 9, type: 'task.skipped', taskId: 'W1-C', blockedBy: 'W1-D' },
      { v: 1, seq: 10, type: 'final.test.ended', outcome: 'pass', runInstructions: 'npm test' },
      { v: 1, seq: 11, type: 'run.finished', summary: '1 merged, 1 abandoned, 1 skipped' },
    ]);
    const node = renderRunLedger(state)!;
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
    assert.match(renderRunLedger(state)!.textContent!, /abandoned by hand/);
  });
});

describe('renderTaskDetail', () => {
  /** A task with a spec but no attempts, for the "never run" reading. */
  function unrunBoard(): BoardState {
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
          {
            id: 'W1-A',
            title: 'A',
            wave: 1,
            dependsOn: [],
            touches: ['a.ts'],
            build: 'Create package.json',
            test: 'npm test',
          },
        ],
      },
    ]);
  }

  test('opens as a modal overlay with the facts strip above the scroll body', () => {
    setupDom();
    const state = unrunBoard();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, OPTIONS);
    assert.equal(node.className, 'ov2-detail-overlay');
    const dialog = node.querySelector('.ov2-detail')!;
    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.ok(node.querySelector('.ov2-facts'), 'status facts live in the pinned head');
    assert.ok(node.querySelector('.ov2-detail__body'));
    // The head is not part of the scrolling body, so the title stays put.
    assert.equal(node.querySelector('.ov2-detail__body .ov2-detail__title'), null);
  });

  test('leads with the run and keeps the spec last', () => {
    setupDom();
    const state = unrunBoard();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, OPTIONS);
    const bodyText = node.querySelector('.ov2-detail__body')!.textContent!;
    const filesAt = bodyText.indexOf('Files');
    const attemptsAt = bodyText.indexOf('Attempts');
    const specAt = bodyText.indexOf('Spec');
    assert.ok(filesAt >= 0 && attemptsAt > filesAt, 'Files precede Attempts');
    assert.ok(specAt > attemptsAt, 'the spec is last, not the first screen');
  });

  test('opens the spec for a task that has not run, and folds it once it has', () => {
    setupDom();
    const unrun = unrunBoard();
    const fresh = renderTaskDetail(unrun, unrun.tasks.get('W1-A')!, NO_ACTIONS, OPTIONS);
    assert.equal(fresh.querySelector<HTMLDetailsElement>('.ov2-spec')!.open, true);

    setupDom();
    const ran = board();
    const after = renderTaskDetail(ran, ran.tasks.get('W1-A')!, NO_ACTIONS, OPTIONS);
    const spec = after.querySelector<HTMLDetailsElement>('.ov2-spec');
    if (spec) assert.equal(spec.open, false, 'a task with attempts folds its spec away');
  });

  test('Close and scrim both dismiss via select(null)', () => {
    setupDom();
    const state = board();
    const calls: Array<string | null> = [];
    const actions: BoardActions = {
      ...NO_ACTIONS,
      select: (id) => calls.push(id),
    };
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, actions, OPTIONS);
    node.querySelector<HTMLButtonElement>('[data-focus-key="detail-close"]')!.click();
    assert.deepEqual(calls, [null]);
    calls.length = 0;
    node.click();
    assert.deepEqual(calls, [null]);
  });

  test('the attempt row itself opens the log, and merges have none to open', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, OPTIONS);
    const opens = [...node.querySelectorAll('.ov2-attempt__header')]
      .map((row) => (row as HTMLElement).dataset.focusKey)
      .filter(Boolean);
    // W1-A ran one builder (a1) and has one merge attempt the fold synthesised.
    assert.deepEqual(opens, ['transcript:a1']);
    assert.equal(node.querySelectorAll('.ov2-attempt__header--static').length, 1);
  });

  test('falls back to the declared footprint before a task has merged', () => {
    setupDom();
    const state = unrunBoard();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, OPTIONS);
    assert.ok(node.querySelector('.ov2-files--planned'));
    assert.match(node.textContent!, /a\.ts/);
    assert.match(node.textContent!, /Line counts arrive when the task merges/);
    // No invented zeroes: an unmerged task has no diffstat to show.
    assert.equal(node.querySelector('.ov2-stat--add'), null);
  });

  test('shows real line counts once git has answered', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, {
      ...OPTIONS,
      files: {
        taskId: 'W1-A',
        status: 'ready' as const,
        source: 'merged' as const,
        files: [{ path: 'src/a.ts', additions: 12, deletions: 3, binary: false }],
        additions: 12,
        deletions: 3,
        truncated: false,
        diffs: new Map(),
        expanded: new Set<string>(),
      },
    });
    assert.match(node.querySelector('.ov2-panel__meta')!.textContent!, /1 file/);
    assert.equal(node.querySelector('.ov2-stat--add')!.textContent, '+12');
    // Directory and filename are separate so the filename never gets truncated.
    assert.equal(node.querySelector('.ov2-file__dir')!.textContent, 'src/');
    assert.equal(node.querySelector('.ov2-file__name')!.textContent, 'a.ts');
  });

  test('a file row asks for its own diff rather than loading every patch', () => {
    setupDom();
    const state = board();
    const asked: string[] = [];
    const node = renderTaskDetail(
      state,
      state.tasks.get('W1-A')!,
      { ...NO_ACTIONS, toggleFileDiff: (path) => asked.push(path) },
      {
        ...OPTIONS,
        files: {
          taskId: 'W1-A',
          status: 'ready' as const,
          source: 'merged' as const,
          files: [{ path: 'src/a.ts', additions: 1, deletions: 0, binary: false }],
          additions: 1,
          deletions: 0,
          truncated: false,
          diffs: new Map(),
          expanded: new Set<string>(),
        },
      },
    );
    node.querySelector<HTMLButtonElement>('[data-focus-key="file-toggle:src/a.ts"]')!.click();
    assert.deepEqual(asked, ['src/a.ts']);
  });

  test('renders a loading log as a skeleton, not as a word', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, {
      ...OPTIONS,
      transcript: {
        attemptId: 'a1',
        status: 'loading' as const,
        events: [],
        truncated: false,
        capped: false,
      },
    });
    assert.ok(node.querySelector('.ov2-skeleton--log'));
    assert.equal(node.querySelector('.ov2-log__list'), null);
  });

  test('renders log entries, and says when it was capped', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, {
      ...OPTIONS,
      transcript: {
        attemptId: 'a1',
        status: 'ready' as const,
        events: [{ type: 'tool_call', name: 'read_file', arguments: '{"path":"a.ts"}' }],
        truncated: false,
        capped: true,
      },
    });
    assert.match(node.textContent!, /read_file/);
    // The argument reads as a value, not as a JSON blob.
    assert.match(node.querySelector('.ov2-log__trail')!.textContent!, /path: a\.ts/);
    assert.match(node.textContent!, /ran longer than the log keeps/);
  });

  test('reasoning renders as prose and tool traffic as mono, in separate rows', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, {
      ...OPTIONS,
      transcript: {
        attemptId: 'a1',
        status: 'ready' as const,
        events: [
          { type: 'thinking', text: 'Let me start by exploring the working directory.' },
          { type: 'tool_call', name: 'read_file' },
          { type: 'attempt_end', name: 'pass', summary: 'Created the file.' },
        ],
        truncated: false,
        capped: false,
      },
    });
    assert.equal(node.querySelectorAll('.ov2-log__row').length, 3);
    assert.equal(node.querySelector('.ov2-log__label')!.textContent, 'Thought');
    assert.ok(node.querySelector('.ov2-log__thought'), 'reasoning is prose, not a code row');
    assert.ok(node.querySelector('.ov2-log__row--good'), 'a pass is toned as one');
  });

  test('an empty log says so rather than showing nothing', () => {
    setupDom();
    const state = board();
    const node = renderTaskDetail(state, state.tasks.get('W1-A')!, NO_ACTIONS, {
      ...OPTIONS,
      transcript: {
        attemptId: 'a1',
        status: 'ready' as const,
        events: [],
        truncated: false,
        capped: false,
      },
    });
    assert.match(node.textContent!, /Nothing was recorded/);
  });

  test('says outright that a skipped task did not fail, above everything else', () => {
    setupDom();
    const state = board([
      { v: 1, seq: 8, type: 'task.abandoned', taskId: 'W1-B', reason: 'builder-failed-twice' },
      { v: 1, seq: 9, type: 'task.skipped', taskId: 'W1-C', blockedBy: 'W1-B' },
    ]);
    const node = renderTaskDetail(state, state.tasks.get('W1-C')!, NO_ACTIONS, OPTIONS);
    const alert = node.querySelector('.ov2-alert--warn')!;
    assert.match(alert.textContent!, /did not fail itself/);
    // Alerts come before every section, because they are why the card was opened.
    const body = node.querySelector('.ov2-detail__body')!;
    assert.ok(body.firstElementChild!.classList.contains('ov2-alert'));
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

describe('renderBoardHeader', () => {
  test('uses the orchestrator instrument strip, not a boxed control card', () => {
    setupDom();
    const node = renderBoardHeader(board(), true);
    assert.equal(node.className, 'board-header ob-runhead');
    assert.equal(node.querySelector('.ov2-controls'), null);
    assert.equal(node.querySelector('.ov2-board__header'), null);
    assert.equal(node.querySelector('.board-header__title')?.textContent, 'Example');
    assert.equal(
      node.querySelector('.board-header__badge-label')?.textContent,
      'Running',
    );
    assert.ok(node.querySelector('.board-header__badge--running'));
    assert.equal(
      node.querySelector('[data-board-metric="tasks"] .board-header__metric-value')
        ?.textContent,
      '1/4',
    );
    assert.ok(node.querySelector('.board-header__progress-fill'));
    assert.ok(node.querySelector('.board-header__controls'));
  });

  test('a created board is Ready', () => {
    setupDom();
    const state = derive([
      {
        v: 1,
        seq: 1,
        type: 'board.created',
        boardId: 'b1',
        planPath: 'documentation/plans/x.md',
        name: 'Example',
        waves: [{ n: 1, name: 'Foundations' }],
        tasks: [{ id: 'W1-A', title: 'A', wave: 1, dependsOn: [], touches: ['a.ts'] }],
      },
    ]);
    const node = renderBoardHeader(state, true);
    assert.equal(node.querySelector('.board-header__badge-label')?.textContent, 'Ready');
    assert.ok(node.querySelector('.board-header__badge--ready'));
  });

  test('a dropped stream on a running board is Reconnecting, not Stopped', () => {
    setupDom();
    const node = renderBoardHeader(board(), false);
    assert.equal(
      node.querySelector('.board-header__badge-label')?.textContent,
      'Reconnecting',
    );
    assert.ok(node.querySelector('.board-header__badge--stalled'));
  });

  test('passed-in run controls sit in the toolbar, not under a second card', () => {
    setupDom();
    const controls = document.createElement('div');
    controls.className = 'board-header__controls';
    const start = document.createElement('button');
    start.className = 'board-header__run-btn';
    start.textContent = 'Start';
    controls.appendChild(start);
    const node = renderBoardHeader(board(), true, controls);
    assert.equal(node.querySelector('.board-header__toolbar .board-header__run-btn'), start);
    assert.equal(node.querySelectorAll('.board-header__controls').length, 1);
  });

  test('a failed board renders Failed, not Complete', () => {
    setupDom();
    const state = derive([
      {
        v: 1,
        seq: 1,
        type: 'board.created',
        boardId: 'b1',
        planPath: 'p.md',
        name: 'Example',
        waves: [{ n: 1, name: 'One' }],
        tasks: [{ id: 'W1-A', title: 'A', wave: 1, dependsOn: [], touches: ['a.ts'] }],
      },
      { v: 1, seq: 2, type: 'task.abandoned', taskId: 'W1-A', reason: 'builder-failed-twice' },
      { v: 1, seq: 3, type: 'final.test.ended', outcome: 'fail', runInstructions: 'command: tsc\ncwd: /tmp' },
      { v: 1, seq: 4, type: 'run.finished', summary: 'failed' },
      { v: 1, seq: 5, type: 'board.stopped', reason: 'terminal' },
    ]);
    const node = renderBoardHeader(state, true);
    assert.equal(node.querySelector('.board-header__badge-label')?.textContent, 'Failed');
    assert.ok(node.querySelector('.board-header__badge--failed'));
  });
});
