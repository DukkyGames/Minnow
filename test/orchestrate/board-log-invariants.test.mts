/**
 * Unit tests for board-log invariant checker (B2/B4).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  checkBoardLog,
  sortBoardLogEvents,
  type BoardLogCheckOptions,
  type BoardLogInvariantId,
} from '../../src/state/board-log-invariants.ts';
import type { BoardLogEvent, BoardTaskStatus } from '../../src/types.ts';

const TS = 1_710_000_001_000;
let seq = 0;

function resetSeq(): void {
  seq = 0;
}

function ev(
  type: BoardLogEvent['type'],
  taskId: string | undefined,
  detail: BoardLogEvent['detail'],
  message = type,
): BoardLogEvent {
  const id = `${TS}-${seq++}`;
  return { id, ts: TS, type, level: 'info', taskId, message, detail };
}

function status(
  taskId: string,
  from: BoardTaskStatus,
  to: BoardTaskStatus,
): BoardLogEvent {
  return ev('task_status', taskId, { from, to }, `${taskId}: ${from} → ${to}`);
}

function started(taskId: string): BoardLogEvent {
  return ev('task_started', taskId, { chatId: 'chat-1' }, `${taskId}: build chat started`);
}

function passingFixture(): BoardLogEvent[] {
  resetSeq();
  return [
    ev('board_init', undefined, { summary: '2 tasks, 2 waves' }),
    status('W1-A', 'planned', 'in_progress'),
    started('W1-A'),
    ev('build_verdict', 'W1-A', { verdict: 'pass' }),
    status('W1-A', 'in_progress', 'testing'),
    ev('test_verdict', 'W1-A', { verdict: 'pass' }),
    status('W1-A', 'testing', 'merging'),
    ev('merge_result', 'W1-A', { outcome: 'merged' }),
    status('W1-A', 'merging', 'complete'),
    status('W2-A', 'planned', 'in_progress'),
    started('W2-A'),
    ev('build_verdict', 'W2-A', { verdict: 'pass' }),
    status('W2-A', 'in_progress', 'testing'),
    ev('test_verdict', 'W2-A', { verdict: 'pass' }),
    status('W2-A', 'testing', 'merging'),
    ev('merge_result', 'W2-A', { outcome: 'merged' }),
    status('W2-A', 'merging', 'complete'),
    ev('final_test_started', undefined, { chatId: 'final-chat' }),
    ev('final_test_verdict', undefined, { verdict: 'pass' }),
  ];
}

const PASSING_OPTS: BoardLogCheckOptions = {
  tasks: [
    { id: 'W1-A', wave: 'W1' },
    { id: 'W2-A', wave: 'W2', dependsOn: ['W1-A'] },
  ],
  waveOrder: ['W1', 'W2'],
  expectFinalTest: true,
  requireTerminal: true,
};

function assertInvariantViolation(
  invariant: BoardLogInvariantId,
  events: BoardLogEvent[],
  opts: BoardLogCheckOptions,
): void {
  const result = checkBoardLog(events, opts);
  assert.equal(result.ok, false, `expected violation for ${invariant}`);
  assert.ok(
    result.violations.some((v) => v.id === invariant),
    `expected ${invariant} violation, got: ${JSON.stringify(result.violations)}`,
  );
}

describe('sortBoardLogEvents', () => {
  test('orders by ts then numeric id suffix', () => {
    const events: BoardLogEvent[] = [
      { id: `${TS}-2`, ts: TS, type: 'auto_stop', level: 'info', message: 'b' },
      { id: `${TS}-0`, ts: TS, type: 'auto_start', level: 'info', message: 'a' },
      { id: `${TS}-10`, ts: TS, type: 'mode_change', level: 'info', message: 'c' },
    ];
    const sorted = sortBoardLogEvents(events);
    assert.deepEqual(sorted.map((e) => e.id), [`${TS}-0`, `${TS}-2`, `${TS}-10`]);
  });
});

describe('checkBoardLog', () => {
  test('passing multi-wave fixture is ok', () => {
    const result = checkBoardLog(passingFixture(), PASSING_OPTS);
    assert.equal(result.ok, true, JSON.stringify(result.violations));
    assert.equal(result.stats.events, passingFixture().length);
  });

  test('status-transitions flags illegal edge', () => {
    resetSeq();
    const events = [
      status('W1-A', 'planned', 'in_progress'),
      started('W1-A'),
      status('W1-A', 'in_progress', 'complete'),
    ];
    assertInvariantViolation('status-transitions', events, {
      tasks: [{ id: 'W1-A', wave: 'W1' }],
      skip: ['verdict-after-start', 'merge-integrity', 'attempt-caps', 'final-test-order', 'wave-order', 'dependency-order', 'quarantine-cascade'],
    });
  });

  test('status-transitions allows fast merge path testing → complete', () => {
    resetSeq();
    const events = [
      status('W1-A', 'planned', 'in_progress'),
      started('W1-A'),
      ev('build_verdict', 'W1-A', { verdict: 'pass' }),
      status('W1-A', 'in_progress', 'testing'),
      ev('test_verdict', 'W1-A', { verdict: 'pass' }),
      ev('merge_result', 'W1-A', { outcome: 'skipped' }),
      status('W1-A', 'testing', 'complete'),
    ];
    const result = checkBoardLog(events, {
      tasks: [{ id: 'W1-A', wave: 'W1' }],
      skip: ['wave-order', 'dependency-order', 'quarantine-cascade', 'final-test-order'],
    });
    assert.equal(result.ok, true, JSON.stringify(result.violations));
  });

  test('status-transitions allows failed Tester round to reopen Builder', () => {
    resetSeq();
    const events = [
      status('W1-A', 'planned', 'in_progress'),
      started('W1-A'),
      ev('build_verdict', 'W1-A', { verdict: 'pass' }),
      status('W1-A', 'in_progress', 'testing'),
      ev('test_verdict', 'W1-A', { verdict: 'fail', attempt: 1 }),
      ev('task_retry', 'W1-A', { attemptKind: 'test', attempt: 1 }),
      status('W1-A', 'testing', 'in_progress'),
    ];
    const result = checkBoardLog(events, {
      tasks: [{ id: 'W1-A', wave: 'W1' }],
      skip: ['merge-integrity', 'wave-order', 'dependency-order', 'quarantine-cascade', 'final-test-order'],
    });
    assert.equal(result.ok, true, JSON.stringify(result.violations));
  });

  test('verdict-after-start flags verdict before task_started', () => {
    resetSeq();
    const events = [
      ev('build_verdict', 'W1-A', { verdict: 'pass' }),
      started('W1-A'),
    ];
    assertInvariantViolation('verdict-after-start', events, {
      tasks: [{ id: 'W1-A', wave: 'W1' }],
      skip: ['status-transitions', 'merge-integrity', 'attempt-caps', 'final-test-order', 'wave-order', 'dependency-order', 'quarantine-cascade'],
    });
  });

  test('attempt-caps flags retry above cap', () => {
    resetSeq();
    const events = [
      status('W1-A', 'planned', 'in_progress'),
      started('W1-A'),
      ev('task_retry', 'W1-A', { attemptKind: 'build', attempt: 3 }),
    ];
    assertInvariantViolation('attempt-caps', events, {
      tasks: [{ id: 'W1-A', wave: 'W1' }],
      caps: { build: 2, test: 3, fixer: 2, nudge: 2 },
      skip: ['status-transitions', 'verdict-after-start', 'merge-integrity', 'final-test-order', 'wave-order', 'dependency-order', 'quarantine-cascade'],
    });
  });

  test('merge-integrity flags missing merge_result for completed task', () => {
    resetSeq();
    const events = [
      status('W1-A', 'planned', 'in_progress'),
      started('W1-A'),
      status('W1-A', 'in_progress', 'testing'),
      status('W1-A', 'testing', 'merging'),
      status('W1-A', 'merging', 'complete'),
    ];
    assertInvariantViolation('merge-integrity', events, {
      tasks: [{ id: 'W1-A', wave: 'W1' }],
      skip: ['status-transitions', 'verdict-after-start', 'attempt-caps', 'final-test-order', 'wave-order', 'dependency-order', 'quarantine-cascade'],
    });
  });

  test('final-test-order flags verdict before start', () => {
    resetSeq();
    const events = [
      ev('final_test_verdict', undefined, { verdict: 'pass' }),
    ];
    assertInvariantViolation('final-test-order', events, {
      tasks: [{ id: 'W1-A', wave: 'W1' }],
      skip: ['status-transitions', 'verdict-after-start', 'attempt-caps', 'merge-integrity', 'wave-order', 'dependency-order', 'quarantine-cascade'],
    });
  });

  test('wave-order flags later wave starting early', () => {
    resetSeq();
    const events = [
      status('W2-A', 'planned', 'in_progress'),
      started('W2-A'),
    ];
    assertInvariantViolation('wave-order', events, {
      tasks: [
        { id: 'W1-A', wave: 'W1' },
        { id: 'W2-A', wave: 'W2' },
      ],
      waveOrder: ['W1', 'W2'],
      skip: ['status-transitions', 'verdict-after-start', 'attempt-caps', 'merge-integrity', 'final-test-order', 'dependency-order', 'quarantine-cascade'],
    });
  });

  test('dependency-order flags start before dependency complete', () => {
    resetSeq();
    const events = [
      status('W2-A', 'planned', 'in_progress'),
      started('W2-A'),
    ];
    assertInvariantViolation('dependency-order', events, {
      tasks: [
        { id: 'W1-A', wave: 'W1' },
        { id: 'W2-A', wave: 'W2', dependsOn: ['W1-A'] },
      ],
      waveOrder: ['W1', 'W2'],
      skip: ['status-transitions', 'verdict-after-start', 'attempt-caps', 'merge-integrity', 'final-test-order', 'wave-order', 'quarantine-cascade'],
    });
  });

  test('quarantine-cascade flags root without dependents and without cap attempts', () => {
    resetSeq();
    const events = [
      status('W1-A', 'planned', 'in_progress'),
      started('W1-A'),
      ev('task_quarantined', 'W1-A', {
        from: 'in_progress',
        to: 'quarantined',
        cause: 'root',
        category: 'stall',
        summary: 'stalled',
      }),
    ];
    assertInvariantViolation('quarantine-cascade', events, {
      tasks: [
        { id: 'W1-A', wave: 'W1' },
        { id: 'W2-A', wave: 'W2', dependsOn: ['W1-A'] },
      ],
      waveOrder: ['W1', 'W2'],
      skip: ['status-transitions', 'verdict-after-start', 'attempt-caps', 'merge-integrity', 'final-test-order', 'wave-order', 'dependency-order'],
    });
  });

  test('known-bad quarantine-stall sequence leaves pending work unrunnable', () => {
    resetSeq();
    const events = [
      status('W1-A', 'planned', 'in_progress'),
      started('W1-A'),
      ev('task_retry', 'W1-A', { attemptKind: 'build', attempt: 2 }),
      ev('task_quarantined', 'W1-A', {
        from: 'in_progress',
        to: 'quarantined',
        cause: 'root',
        category: 'stall',
        summary: 'builder stalled',
      }),
      status('W2-A', 'planned', 'in_progress'),
      started('W2-A'),
    ];
    const result = checkBoardLog(events, {
      tasks: [
        { id: 'W1-A', wave: 'W1' },
        { id: 'W2-A', wave: 'W2', dependsOn: ['W1-A'] },
      ],
      waveOrder: ['W1', 'W2'],
      skip: ['status-transitions', 'verdict-after-start', 'attempt-caps', 'merge-integrity', 'final-test-order'],
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.violations.some((v) => v.id === 'quarantine-cascade'),
      'missing dependent quarantine',
    );
    assert.ok(
      result.violations.some((v) => v.id === 'dependency-order'),
      'dependent started while root incomplete',
    );
    assert.equal(
      result.violations.some((v) => v.id === 'wave-order'),
      false,
      'quarantined wave-1 task is terminal for wave gating',
    );
  });
});

describe('Phase-2 durable invariant families', () => {
  const ALL_INVARIANTS: BoardLogInvariantId[] = [
    'status-transitions',
    'verdict-after-start',
    'attempt-caps',
    'merge-integrity',
    'final-test-order',
    'wave-order',
    'dependency-order',
    'quarantine-cascade',
    'phase-pairing',
    'slot-balance',
    'hold-balance',
    'concurrency-cap',
    'lifecycle-owner',
    'terminal-effects',
    'afk-hands-off',
  ];

  const only = (
    id: BoardLogInvariantId,
    extra: Partial<BoardLogCheckOptions> = {},
  ): BoardLogCheckOptions => ({
    tasks: [{ id: 'W1-A', wave: 'W1' }],
    strictEvidence: true,
    skip: ALL_INVARIANTS.filter((item) => item !== id),
    ...extra,
  });

  const cases: Array<{
    id: BoardLogInvariantId;
    passing: () => BoardLogEvent[];
    failing: () => BoardLogEvent[];
    incomplete: () => BoardLogEvent[];
    options?: Partial<BoardLogCheckOptions>;
  }> = [
    {
      id: 'phase-pairing',
      passing: () => [
        ev('phase_start', 'W1-A', { phaseId: 'p1', phase: 'build', lifecycleRun: 1 }),
        ev('phase_end', 'W1-A', { phaseId: 'p1', phase: 'build', lifecycleRun: 1 }),
      ],
      failing: () => [ev('phase_end', 'W1-A', { phaseId: 'p1', phase: 'build', lifecycleRun: 1 })],
      incomplete: () => [ev('phase_start', 'W1-A', { phaseId: 'p1', phase: 'build', lifecycleRun: 1 })],
    },
    {
      id: 'slot-balance',
      passing: () => [
        ev('slot_acquire', 'W1-A', { slotId: 's1', phase: 'build' }),
        ev('slot_release', 'W1-A', { slotId: 's1', phase: 'build' }),
      ],
      failing: () => [ev('slot_release', 'W1-A', { slotId: 's1' })],
      incomplete: () => [ev('slot_acquire', 'W1-A', { slotId: 's1' })],
    },
    {
      id: 'hold-balance',
      passing: () => [
        ev('hold_acquire', 'W1-A', { holdId: 'h1', holdKind: 'merge' }),
        ev('hold_expiry', 'W1-A', { holdId: 'h1', holdKind: 'merge' }),
      ],
      failing: () => [ev('hold_release', 'W1-A', { holdId: 'h1' })],
      incomplete: () => [ev('hold_acquire', 'W1-A', { holdId: 'h1' })],
    },
    {
      id: 'concurrency-cap',
      passing: () => [
        ev('concurrency_observation', undefined, {
          activeSlots: 0,
          activeHolds: 0,
          activeTotal: 0,
          concurrencyCap: 2,
        }),
      ],
      failing: () => [
        ev('concurrency_observation', undefined, {
          activeSlots: 2,
          activeHolds: 1,
          activeTotal: 3,
          concurrencyCap: 2,
        }),
      ],
      incomplete: () => [started('W1-A')],
    },
    {
      id: 'lifecycle-owner',
      passing: () => [
        ev('lifecycle_owner_set', 'W1-A', {
          lifecycleRun: 1,
          ownerId: 'chat-1',
          ownerKind: 'chat',
        }),
        ev('lifecycle_owner_clear', 'W1-A', {
          lifecycleRun: 1,
          ownerId: 'chat-1',
          ownerKind: 'chat',
        }),
      ],
      failing: () => [
        ev('lifecycle_owner_clear', 'W1-A', {
          lifecycleRun: 1,
          ownerId: 'chat-1',
          ownerKind: 'chat',
        }),
      ],
      incomplete: () => [
        ev('lifecycle_owner_set', 'W1-A', {
          lifecycleRun: 1,
          ownerId: 'chat-1',
          ownerKind: 'chat',
        }),
      ],
    },
    {
      id: 'terminal-effects',
      passing: () => [ev('board_terminal', undefined, { terminalOutcome: 'passed' })],
      failing: () => [
        ev('board_terminal', undefined, { terminalOutcome: 'passed' }),
        ev('board_terminal', undefined, { terminalOutcome: 'passed' }),
      ],
      incomplete: () => [],
      options: { requireTerminal: true },
    },
    {
      id: 'afk-hands-off',
      passing: () => [
        ev('mode_change', undefined, { mode: 'afk' }),
        ev('board_terminal', undefined, { terminalOutcome: 'passed' }),
      ],
      failing: () => [
        ev('mode_change', undefined, { mode: 'afk' }),
        ev('interaction_required', 'W1-A', {
          interactionKind: 'question',
          reason: 'Need a decision',
        }),
        ev('board_terminal', undefined, { terminalOutcome: 'blocked' }),
      ],
      incomplete: () => [ev('mode_change', undefined, { mode: 'afk' })],
      options: { executionMode: 'afk' },
    },
  ];

  for (const row of cases) {
    test(`${row.id}: passing evidence`, () => {
      resetSeq();
      const result = checkBoardLog(row.passing(), only(row.id, row.options));
      assert.equal(
        result.violations.some((item) => item.id === row.id),
        false,
        JSON.stringify(result),
      );
      assert.equal(result.incompleteEvidence.some((item) => item.id === row.id), false);
    });

    test(`${row.id}: failing evidence`, () => {
      resetSeq();
      const result = checkBoardLog(row.failing(), only(row.id, row.options));
      assert.equal(result.ok, false);
      assert.ok(result.violations.some((item) => item.id === row.id), JSON.stringify(result));
    });

    test(`${row.id}: incomplete evidence`, () => {
      resetSeq();
      const result = checkBoardLog(row.incomplete(), only(row.id, row.options));
      assert.equal(result.ok, false);
      assert.equal(result.status, 'incomplete');
      assert.ok(
        result.incompleteEvidence.some((item) => item.id === row.id),
        JSON.stringify(result),
      );
    });
  }

  test('legacy logs remain compatible but cannot pass strict evidence mode', () => {
    const compatible = checkBoardLog(passingFixture(), PASSING_OPTS);
    assert.equal(compatible.ok, true);
    assert.equal(compatible.status, 'incomplete');
    assert.ok(compatible.incompleteEvidence.length > 0);

    const strict = checkBoardLog(passingFixture(), { ...PASSING_OPTS, strictEvidence: true });
    assert.equal(strict.ok, false);
    assert.equal(strict.status, 'incomplete');
  });

  test('nudge events participate in the persisted attempt cap', () => {
    resetSeq();
    const result = checkBoardLog(
      [ev('nudge', 'W1-A', { attemptKind: 'nudge', attempt: 3 })],
      only('attempt-caps', { caps: { nudge: 2 } }),
    );
    assert.ok(result.violations.some((item) => item.id === 'attempt-caps'));
  });

  test('terminal effects reject duplicate planner reports and notifications', () => {
    resetSeq();
    const result = checkBoardLog(
      [
        ev('planner_report', undefined, { reportId: 'report-1' }),
        ev('planner_report', undefined, { reportId: 'report-1' }),
        ev('completion_notification', undefined, { notificationId: 'note-1' }),
        ev('completion_notification', undefined, { notificationId: 'note-1' }),
      ],
      only('terminal-effects'),
    );
    assert.equal(result.ok, false);
    assert.equal(
      result.violations.filter((item) => item.id === 'terminal-effects').length,
      2,
    );
  });

  test('returns reconstructed state and acceptance metrics', () => {
    resetSeq();
    const events = [
      ev('slot_acquire', 'W1-A', { slotId: 's1' }),
      ev('hold_acquire', 'W1-A', { holdId: 'h1', holdKind: 'merge' }),
      ev('concurrency_observation', undefined, {
        activeSlots: 1,
        activeHolds: 1,
        activeTotal: 2,
        concurrencyCap: 3,
      }),
    ];
    const result = checkBoardLog(events, { tasks: [{ id: 'W1-A' }] });
    assert.deepEqual(result.reconstructed.activeSlotIds, ['s1']);
    assert.deepEqual(result.reconstructed.activeHoldIds, ['h1']);
    assert.equal(result.metrics.peakActiveTotal, 2);
    assert.equal(result.metrics.configuredConcurrencyCap, 3);
  });
});
