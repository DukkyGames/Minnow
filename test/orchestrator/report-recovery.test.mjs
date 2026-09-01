/**
 * Board agents sometimes dump a findings JSON blob instead of calling
 * report_outcome (the inner loop used to ask for that schema). Recovery
 * lives on the effector, not inside runTurn.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { recoverBoardReportIfDumped } from '../../server/orchestrator/effector-runner.js';

const DUMP = {
  summary:
    'W1-A is already complete and committed (4920df0) but that commit was never merged into the integration branch.',
  findings: [
    {
      title: 'W1-A scaffold exists in commit 4920df0 but is not in the integration branch',
      detail: 'git branch --contains shows only the task branch.',
      severity: 'warn',
      paths: ['package.json'],
    },
    {
      title: 'Failing rung typecheck is not applicable',
      detail: 'The project is plain JavaScript with no tsconfig.',
      severity: 'warn',
      paths: ['.minnow/jsconfig.json'],
    },
    {
      title: 'Scaffold files must be merged into the integration branch',
      detail: 'The current worktree does not contain these files.',
      severity: 'blocker',
      paths: ['package.json', 'electron/main.js'],
    },
  ],
  artifacts: [
    { kind: 'path', label: 'W1-A scaffold commit', ref: '4920df0fb1cc6841e9d4db6d744ef2b6ede12c7e' },
  ],
};

describe('recoverBoardReportIfDumped', () => {
  test('plain prose stays no_report', () => {
    const out = recoverBoardReportIfDumped(
      { outcome: 'no_report' },
      [{ role: 'assistant', content: 'I finished but I will not call the tool.' }],
      'tester',
    );
    assert.equal(out.outcome, 'no_report');
  });

  test('findings dump with a blocker is tester fail', () => {
    const out = recoverBoardReportIfDumped(
      { outcome: 'no_report' },
      [{ role: 'assistant', content: JSON.stringify(DUMP) }],
      'tester',
    );
    assert.equal(out.outcome, 'fail');
    assert.match(out.summary, /W1-A is already complete/);
    assert.ok(Array.isArray(out.blockers) && out.blockers.length >= 1);
  });

  test('findings dump with a blocker is builder blocked', () => {
    const out = recoverBoardReportIfDumped(
      { outcome: 'no_report' },
      [{ role: 'assistant', content: JSON.stringify(DUMP) }],
      'builder',
    );
    assert.equal(out.outcome, 'blocked');
    assert.ok(Array.isArray(out.needs) && out.needs.length >= 1);
  });

  test('valid report_outcome JSON in assistant text is accepted', () => {
    const payload = {
      outcome: 'fail',
      summary: 'Typecheck failed.',
      evidence: ['npx tsc --noEmit'],
      testOutput: 'error TS',
    };
    const out = recoverBoardReportIfDumped(
      { outcome: 'no_report' },
      [{ role: 'assistant', content: JSON.stringify(payload) }],
      'tester',
    );
    assert.equal(out.outcome, 'fail');
    assert.equal(out.summary, payload.summary);
  });

  test('successful report_outcome is left alone', () => {
    const pass = { outcome: 'pass', summary: 'ok', evidence: [] };
    const out = recoverBoardReportIfDumped(pass, [{ role: 'assistant', content: 'ignored' }], 'tester');
    assert.equal(out, pass);
  });
});
