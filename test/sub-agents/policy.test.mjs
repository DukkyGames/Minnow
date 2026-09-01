/**
 * P8-C — the policy table. Exhaustive over outcome × attempts, not by example.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_OUTCOMES } from '../../server/sub-agents/events.js';
import {
  decide,
  formatPolicyTable,
  POLICY_TABLE,
} from '../../server/sub-agents/policy.js';

const OUTCOMES = [...ATTEMPT_OUTCOMES, 'cancel', 'conflicted'];
const ATTEMPTS = [0, 1, 2, 3, 4, 5];

function* space() {
  for (const outcome of OUTCOMES) {
    for (const attemptCount of ATTEMPTS) yield { outcome, attemptCount };
  }
}

describe('decide — totality', () => {
  it('returns a defined action for every cell of outcome × attempts', () => {
    let cells = 0;
    for (const input of space()) {
      const action = decide(input);
      cells += 1;
      assert.ok(action, `no action for ${input.outcome}/${input.attemptCount}`);
      assert.ok(
        ['retry', 'deliver', 'done', 'abandon'].includes(action.kind),
        `unknown action kind ${action.kind}`,
      );
    }
    assert.equal(cells, OUTCOMES.length * ATTEMPTS.length);
  });

  it('is a table, not a chain of ifs', () => {
    assert.ok(Array.isArray(POLICY_TABLE));
    assert.ok(POLICY_TABLE.length >= 8);
    for (const row of POLICY_TABLE) {
      assert.ok('outcome' in row);
      assert.ok('under' in row);
      assert.ok(row.action && typeof row.action.kind === 'string');
    }
    const last = POLICY_TABLE[POLICY_TABLE.length - 1];
    assert.equal(last.outcome, '*');
  });

  it('never mutates the table it read from', () => {
    const before = JSON.stringify(POLICY_TABLE);
    for (const input of space()) decide(input);
    assert.equal(JSON.stringify(POLICY_TABLE), before);
  });

  it('returns a fresh action object each call', () => {
    const a = decide({ outcome: 'fail', attemptCount: 0 });
    const b = decide({ outcome: 'fail', attemptCount: 0 });
    assert.deepEqual(a, b);
    assert.notEqual(a, b);
  });
});

describe('decide — documented rows', () => {
  it('matches the table cell for cell', () => {
    const rows = [
      ['pass', 0, { kind: 'deliver' }],
      ['pass', 5, { kind: 'deliver' }],
      ['fail', 0, { kind: 'retry', seedKind: 'continue' }],
      ['fail', 1, { kind: 'retry', seedKind: 'continue' }],
      ['fail', 2, 'abandon'],
      ['blocked', 0, { kind: 'retry', seedKind: 'continue' }],
      ['blocked', 1, 'abandon'],
      ['no_report', 0, { kind: 'retry', seedKind: 'continue' }],
      ['no_report', 1, 'abandon'],
      ['crashed', 0, { kind: 'retry', seedKind: 'continue' }],
      ['crashed', 1, { kind: 'retry', seedKind: 'continue' }],
      ['crashed', 2, 'abandon'],
      ['timeout', 0, { kind: 'retry', seedKind: 'continue' }],
      ['timeout', 2, 'abandon'],
      ['cancel', 0, { kind: 'done', reason: 'user' }],
      ['cancel', 9, { kind: 'done', reason: 'user' }],
    ];
    for (const [outcome, attemptCount, expected] of rows) {
      const action = decide({ outcome, attemptCount });
      const label = `${outcome}/${attemptCount}`;
      if (expected === 'abandon') {
        assert.equal(action.kind, 'abandon', label);
      } else {
        assert.equal(action.kind, expected.kind, label);
        if (expected.seedKind) assert.equal(action.seedKind, expected.seedKind, label);
        if (expected.reason) assert.equal(action.reason, expected.reason, label);
      }
    }
  });

  it('renders the whole table with nothing hidden', () => {
    assert.equal(
      formatPolicyTable(),
      [
        '| outcome | attempts | action |',
        '| --- | --- | --- |',
        '| pass | — | deliver (result.delivered) |',
        '| fail | < 2 | retry, continue seed |',
        '| fail | — | abandon (failed) |',
        '| blocked | < 1 | retry, continue seed |',
        '| blocked | — | abandon (blocked) |',
        '| no_report | < 1 | retry, continue seed |',
        '| no_report | — | abandon (no-report) |',
        '| crashed | < 2 | retry, continue seed |',
        '| crashed | — | abandon (crashed) |',
        '| timeout | < 2 | retry, continue seed |',
        '| timeout | — | abandon (timeout) |',
        '| cancel | — | done (user) |',
        '| * | — | abandon (unhandled-outcome) |',
      ].join('\n'),
    );
  });

  it('user cancel is not a failure', () => {
    const action = decide({ outcome: 'cancel', attemptCount: 0 });
    assert.equal(action.kind, 'done');
    assert.notEqual(action.kind, 'abandon');
  });
});
