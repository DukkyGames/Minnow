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
