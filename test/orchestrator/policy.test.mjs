/**
 * P0-E — the policy table.
 *
 * Exhaustive, not by example. The point of collapsing V1's six call sites and
 * six counters into one table is that the table can be enumerated; a test that
 * checked a handful of interesting cases would give that up.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_OUTCOMES, ROLES } from '../../server/orchestrator/core/events.js';
import {
  decide,
  formatPolicyTable,
  POLICY_TABLE,
} from '../../server/orchestrator/core/policy.js';

/** Every outcome the table can be asked about — the six-way union plus merge's. */
const OUTCOMES = [...ATTEMPT_OUTCOMES, 'conflicted'];
const ATTEMPTS = [0, 1, 2, 3, 4, 5];

/** The full input space. */
function* space() {
  for (const role of ROLES) {
    for (const outcome of OUTCOMES) {
      for (const attemptCount of ATTEMPTS) yield { role, outcome, attemptCount };
    }
  }
}

describe('decide — totality', () => {
  it('returns a defined action for every cell of role × outcome × attempts', () => {
    let cells = 0;
    for (const input of space()) {
      const action = decide(input);
      cells += 1;
      assert.ok(action, `no action for ${input.role}/${input.outcome}/${input.attemptCount}`);
      assert.ok(
        ['retry', 'advance', 'abandon'].includes(action.kind),
        `unknown action kind ${action.kind}`,
      );
    }
    assert.equal(cells, ROLES.length * OUTCOMES.length * ATTEMPTS.length);
    assert.equal(cells, 168);
  });

  it('is total over inputs the table was never written for', () => {
    for (const input of [
      { role: 'wizard', outcome: 'pass', attemptCount: 0 },
      { role: 'builder', outcome: 'exploded', attemptCount: 0 },
      { role: 'builder', outcome: 'fail', attemptCount: Number.NaN },
      { role: 'builder', outcome: 'fail', attemptCount: -1 },
      { role: 'builder', outcome: 'fail', attemptCount: 1e9 },
    ]) {
      const action = decide(input);
      assert.ok(['retry', 'advance', 'abandon'].includes(action.kind), JSON.stringify(input));
    }
    assert.equal(decide({ role: 'wizard', outcome: 'pass', attemptCount: 0 }).reason, 'unhandled-outcome');
  });

  it('never mutates the table it read from', () => {
    const before = JSON.stringify(POLICY_TABLE);
    for (const input of space()) decide(input);
    assert.equal(JSON.stringify(POLICY_TABLE), before);
  });

  it('returns a fresh action object each call', () => {
    const a = decide({ role: 'builder', outcome: 'fail', attemptCount: 0 });
    const b = decide({ role: 'builder', outcome: 'fail', attemptCount: 0 });
    assert.deepEqual(a, b);
    assert.notEqual(a, b, 'callers must not be able to mutate the table through the result');
  });
});

describe('decide — the documented rows, cell for cell', () => {
  it('matches the table in the issue', () => {
    const rows = [
      ['builder', 'pass', 0, { kind: 'advance', to: 'tester' }],
      ['builder', 'pass', 5, { kind: 'advance', to: 'tester' }],
      ['builder', 'fail', 0, { kind: 'retry', role: 'builder', seedKind: 'failure-aware', sameWorktree: false }],
      ['builder', 'fail', 1, { kind: 'retry', role: 'builder', seedKind: 'failure-aware', sameWorktree: false }],
      ['builder', 'fail', 2, 'abandon'],
      ['builder', 'fail', 3, 'abandon'],
      ['builder', 'blocked', 0, { kind: 'retry', role: 'builder', seedKind: 'repair', sameWorktree: true }],
      ['builder', 'blocked', 1, 'abandon'],
      ['builder', 'no_report', 0, { kind: 'retry', role: 'builder', seedKind: 'continue', sameWorktree: false }],
      ['builder', 'no_report', 1, 'abandon'],
      ['builder', 'crashed', 0, { kind: 'retry', role: 'builder', seedKind: 'continue', sameWorktree: false }],
      ['builder', 'crashed', 1, { kind: 'retry', role: 'builder', seedKind: 'continue', sameWorktree: false }],
      ['builder', 'crashed', 2, 'abandon'],
      ['builder', 'timeout', 0, { kind: 'retry', role: 'builder', seedKind: 'continue', sameWorktree: false }],
      ['builder', 'timeout', 2, 'abandon'],
      ['tester', 'pass', 0, { kind: 'advance', to: 'merge' }],
      ['tester', 'fail', 0, { kind: 'retry', role: 'builder', seedKind: 'fix', sameWorktree: false }],
      ['tester', 'fail', 1, { kind: 'retry', role: 'builder', seedKind: 'fix', sameWorktree: false }],
      ['tester', 'fail', 2, 'abandon'],
      ['merge', 'conflicted', 0, { kind: 'retry', role: 'builder', seedKind: 'rebase', sameWorktree: false }],
      ['merge', 'conflicted', 1, { kind: 'retry', role: 'builder', seedKind: 'rebase', sameWorktree: false }],
      ['merge', 'conflicted', 2, 'abandon'],
    ];
    for (const [role, outcome, attemptCount, expected] of rows) {
      const action = decide({ role, outcome, attemptCount });
      const label = `${role}/${outcome}/${attemptCount}`;
      if (expected === 'abandon') {
        assert.equal(action.kind, 'abandon', label);
      } else {
        assert.deepEqual(action, expected, label);
      }
    }
  });

  it('the rendered table is stable and readable', () => {
    const markdown = formatPolicyTable();
    assert.match(markdown, /\| builder \| pass \| — \| advance → tester \|/);
    assert.match(markdown, /\| builder \| fail \| < 2 \| retry builder, failure-aware seed \|/);
    assert.match(markdown, /\| builder \| blocked \| < 1 \| retry builder, repair seed \(same worktree\) \|/);
    assert.match(markdown, /\| tester \| pass \| — \| advance → merge \|/);
    assert.match(markdown, /\| tester \| fail \| < 2 \| retry builder, fix seed \|/);
    assert.match(markdown, /\| merge \| conflicted \| < 2 \| retry builder, rebase seed \|/);
    // Every row of the table is rendered; nothing is hidden from review.
    assert.equal(markdown.split('\n').length, POLICY_TABLE.length + 2);
  });
});

describe('decide — structural invariants', () => {
  it('every retry targets the builder', () => {
    // One forward edge (builder → tester) and one backward target (builder).
    for (const input of space()) {
      const action = decide(input);
      if (action.kind === 'retry') {
        assert.equal(action.role, 'builder', `${input.role}/${input.outcome} retried ${action.role}`);
      }
    }
    for (const row of POLICY_TABLE) {
      if (row.action.kind === 'retry') assert.equal(row.action.role, 'builder');
    }
  });

  it('advance moves forward only, one step at a time', () => {
    const forward = { builder: 'tester', tester: 'merge', merge: 'done', final: 'done' };
    for (const input of space()) {
      const action = decide(input);
      if (action.kind === 'advance') assert.equal(action.to, forward[input.role]);
    }
  });

  it('only pass ever advances', () => {
    for (const input of space()) {
      if (input.outcome === 'pass') continue;
      assert.notEqual(decide(input).kind, 'advance', `${input.role}/${input.outcome} advanced`);
    }
  });

  it('every abandon carries a non-empty reason and its evidence', () => {
    for (const input of space()) {
      const action = decide(input);
      if (action.kind !== 'abandon') continue;
      assert.ok(action.reason.length > 0, `${input.role}/${input.outcome}: empty reason`);
      assert.match(action.reason, /^[a-z][a-z0-9-]*$/, 'reason must be machine-readable');
      assert.deepEqual(action.evidence, {
        role: input.role,
        outcome: input.outcome,
        attemptCount: input.attemptCount,
      });
    }
  });

  it('carries the summary and detail through into the evidence', () => {
    const action = decide({
      role: 'builder',
      outcome: 'fail',
      attemptCount: 2,
      summary: 'could not make the type check pass',
      evidence: { lastTestOutput: 'TS2339' },
    });
    assert.equal(action.kind, 'abandon');
    assert.deepEqual(action.evidence, {
      role: 'builder',
      outcome: 'fail',
      attemptCount: 2,
      summary: 'could not make the type check pass',
      detail: { lastTestOutput: 'TS2339' },
    });
  });

  it('is monotone in attempt count: retries never come back after an abandon', () => {
    for (const role of ROLES) {
      for (const outcome of OUTCOMES) {
        let abandoned = false;
        for (const attemptCount of [0, 1, 2, 3, 4, 5, 20, 1000]) {
          const kind = decide({ role, outcome, attemptCount }).kind;
          if (abandoned) {
            assert.notEqual(kind, 'retry', `${role}/${outcome} retried again at ${attemptCount}`);
          }
          if (kind === 'abandon') abandoned = true;
        }
      }
    }
  });

  it('terminates: repeated application reaches advance or abandon', () => {
    for (const role of ROLES) {
      for (const outcome of OUTCOMES) {
        let attemptCount = 0;
        let steps = 0;
        let terminal = null;
        while (steps < 100) {
          const action = decide({ role, outcome, attemptCount });
          steps += 1;
          if (action.kind !== 'retry') {
            terminal = action.kind;
            break;
          }
          attemptCount += 1;
        }
        assert.ok(terminal, `${role}/${outcome} never terminated`);
        assert.ok(steps <= 3, `${role}/${outcome} took ${steps} attempts to terminate`);
      }
    }
  });

  it('the table is data, not control flow', () => {
    assert.ok(Array.isArray(POLICY_TABLE));
    assert.ok(POLICY_TABLE.length >= 12);
    for (const row of POLICY_TABLE) {
      assert.equal(typeof row.role, 'string');
      assert.equal(typeof row.outcome, 'string');
      assert.ok(row.under === null || Number.isInteger(row.under));
      assert.ok(['retry', 'advance', 'abandon'].includes(row.action.kind));
    }
  });

  it('has no unreachable row', () => {
    const reached = new Set();
    for (const input of space()) {
      const index = POLICY_TABLE.findIndex(
        (r) =>
          (r.role === '*' || r.role === input.role) &&
          (r.outcome === '*' || r.outcome === input.outcome) &&
          (r.under === null || input.attemptCount < r.under),
      );
      reached.add(index);
    }
    // The final catch-all is reachable only by inputs outside the declared space,
    // which the totality test above covers.
    const unreachable = POLICY_TABLE.map((_, i) => i)
      .filter((i) => !reached.has(i) && i !== POLICY_TABLE.length - 1);
    assert.deepEqual(unreachable, []);
  });
});

describe('decide — what is deliberately absent', () => {
  it('makes no model call and reads nothing outside its input', async () => {
    // A model call in the control plane would forfeit replay, which is the
    // mechanism the whole engine depends on. Enforced structurally.
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../../server/orchestrator/core/policy.js', import.meta.url), 'utf8'),
    );
    for (const forbidden of ['fetch(', 'generate', 'completion', 'prompt(', 'await ']) {
      assert.equal(source.includes(forbidden), false, `policy.js contains ${forbidden}`);
    }
  });

  it('has no env-fixer and no merge-fixer role', () => {
    for (const row of POLICY_TABLE) {
      assert.doesNotMatch(row.role, /fixer/);
      if (row.action.kind === 'retry') assert.doesNotMatch(row.action.role, /fixer/);
    }
    // `blocked` repairs in the builder's own worktree instead.
    const repair = decide({ role: 'builder', outcome: 'blocked', attemptCount: 0 });
    assert.equal(repair.seedKind, 'repair');
    assert.equal(repair.sameWorktree, true);
  });
});
