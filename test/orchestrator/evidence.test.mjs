/**
 * P3-H — abandonment evidence bundle and journal query (MIN-712 / PRD §11).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeEvent } from '../../server/orchestrator/core/events.js';
import {
  abandonmentEvidenceIsComplete,
  bundleAbandonmentEvidence,
  capDiffText,
  MAX_DIFF_CHARS,
  queryAbandonments,
} from '../../server/orchestrator/core/evidence.js';

describe('capDiffText', () => {
  it('leaves a small patch alone', () => {
    assert.deepEqual(capDiffText('diff --git a/x b/x\n'), {
      text: 'diff --git a/x b/x\n',
      truncated: false,
    });
  });

  it('caps a repo-sized dump without dropping the rest of history', () => {
    const huge = 'a'.repeat(MAX_DIFF_CHARS + 50);
    const capped = capDiffText(huge);
    assert.equal(capped.text.length, MAX_DIFF_CHARS);
    assert.equal(capped.truncated, true);
    assert.equal(capped.originalLength, huge.length);
  });
});

describe('bundleAbandonmentEvidence', () => {
  it('never truncates the attempt list', () => {
    const attempts = Array.from({ length: 12 }, (_, i) => ({
      attemptId: `a${i}`,
      role: 'builder',
      worktree: null,
      seedKind: i === 0 ? 'initial' : 'failure-aware',
      ended: true,
      outcome: 'fail',
      summary: `try ${i}`,
      evidence: { testOutput: `out ${i}` },
      manual: false,
    }));
    const evidence = bundleAbandonmentEvidence(
      { attempts },
      { evidence: { role: 'builder', outcome: 'fail', attemptCount: 11 } },
    );
    assert.equal(evidence.attempts.length, 12);
    assert.equal(evidence.attempts[11].seedKind, 'failure-aware');
    assert.equal(evidence.attempts[3].testOutput, 'out 3');
    assert.ok(abandonmentEvidenceIsComplete(evidence));
  });

  it('promotes needs and blockers from blocked reports', () => {
    const evidence = bundleAbandonmentEvidence(
      {
        attempts: [
          {
            attemptId: 'a1',
            role: 'builder',
            worktree: '/tmp/wt',
            seedKind: 'initial',
            ended: true,
            outcome: 'blocked',
            summary: 'no database',
            evidence: { needs: ['DATABASE_URL'], blockers: ['psql refused'] },
            manual: false,
          },
        ],
      },
      { evidence: { role: 'builder', outcome: 'blocked', attemptCount: 1 } },
    );
    assert.deepEqual(evidence.attempts[0].needs, ['DATABASE_URL']);
    assert.deepEqual(evidence.attempts[0].blockers, ['psql refused']);
  });
});

describe('queryAbandonments — journal alone', () => {
  it('reconstructs full history when task.abandoned evidence is thin', () => {
    const events = [
      makeEvent('board.created', { boardId: 'b', planPath: 'p', tasks: [], waves: [] }),
      makeEvent('task.attempt.started', {
        taskId: 'A',
        attemptId: 'a1',
        role: 'builder',
        seedKind: 'initial',
      }),
      makeEvent('task.attempt.ended', {
        taskId: 'A',
        attemptId: 'a1',
        role: 'builder',
        outcome: 'fail',
        summary: 'first',
        evidence: { testOutput: 'err 1' },
      }),
      makeEvent('task.attempt.started', {
        taskId: 'A',
        attemptId: 'a2',
        role: 'builder',
        seedKind: 'failure-aware',
      }),
      makeEvent('task.attempt.ended', {
        taskId: 'A',
        attemptId: 'a2',
        role: 'builder',
        outcome: 'fail',
        summary: 'second',
        evidence: { testOutput: 'err 2', diff: { files: ['src/a.ts'], patch: '+x' } },
      }),
      makeEvent('task.abandoned', {
        taskId: 'A',
        reason: 'builder-failed',
        evidence: { role: 'builder', outcome: 'fail', attemptCount: 1 },
      }),
    ];

    const [row] = queryAbandonments(events);
    assert.equal(row.taskId, 'A');
    assert.equal(row.reason, 'builder-failed');
    assert.equal(row.evidence.attempts.length, 2);
    assert.equal(row.evidence.attempts[0].seedKind, 'initial');
    assert.equal(row.evidence.attempts[1].seedKind, 'failure-aware');
    assert.equal(row.evidence.attempts[0].testOutput, 'err 1');
    assert.equal(row.evidence.attempts[1].diff.patch, '+x');
    assert.ok(abandonmentEvidenceIsComplete(row.evidence));
  });

  it('prefers the journaled attempts list when it is already complete', () => {
    const events = [
      makeEvent('task.attempt.started', { taskId: 'A', attemptId: 'a1', role: 'builder' }),
      makeEvent('task.attempt.ended', {
        taskId: 'A',
        attemptId: 'a1',
        role: 'builder',
        outcome: 'fail',
      }),
      makeEvent('task.abandoned', {
        taskId: 'A',
        reason: 'builder-failed',
        evidence: {
          role: 'builder',
          outcome: 'fail',
          attemptCount: 0,
          attempts: [{ attemptId: 'a1', role: 'builder', outcome: 'fail', seedKind: 'initial' }],
        },
      }),
    ];
    const [row] = queryAbandonments(events);
    assert.equal(row.evidence.attempts[0].seedKind, 'initial');
  });
});
