/**
 * Triage lane identity and accept/decline writes.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { isUnreviewedTriageIssue } from '../../src/issues/triage.ts';
import {
  acceptTriageIssue,
  addIssue,
  collectIssues,
  declineTriageIssue,
  findIssueById,
  setIssuesNowForTests,
  setIssuesStateForTests,
} from '../../src/state/issues-store.ts';

const FIXED_NOW = 1_710_000_004_000;

describe('triage identity', () => {
  beforeEach(() => {
    setIssuesNowForTests(() => FIXED_NOW);
    setIssuesStateForTests({ version: 2, nextId: 1, issues: [], workspaces: {} });
  });

  test('unreviewed means auto-filed source and no triagedAt', () => {
    assert.equal(isUnreviewedTriageIssue({ source: 'crash' }), true);
    assert.equal(isUnreviewedTriageIssue({ source: 'agent' }), true);
    assert.equal(isUnreviewedTriageIssue({ source: 'github' }), true);
    assert.equal(isUnreviewedTriageIssue({ source: 'user' }), false);
    assert.equal(isUnreviewedTriageIssue({ source: 'crash', triagedAt: 1 }), false);
    assert.equal(isUnreviewedTriageIssue({}), false);
  });

  test('user-created issues do not enter the unreviewed collect', () => {
    addIssue({ title: 'Mine', workspacePath: '/w' }, 'ISS-1');
    const unreviewed = collectIssues({ hideDone: false, scope: 'all', unreviewed: true });
    assert.equal(unreviewed.length, 0);
  });

  test('accept sets backlog-role status and triagedAt', () => {
    addIssue(
      { title: 'Crash', workspacePath: '/w', source: 'crash', status: 'triage' },
      'ISS-2',
    );
    const updated = acceptTriageIssue('ISS-2');
    assert.ok(updated);
    assert.equal(updated?.status, 'backlog');
    assert.equal(updated?.triagedAt, FIXED_NOW);
    assert.equal(isUnreviewedTriageIssue(updated!), false);
  });

  test('decline sets canceled-role status and triagedAt', () => {
    addIssue(
      { title: 'Noise', workspacePath: '/w', source: 'agent', status: 'triage' },
      'ISS-3',
    );
    declineTriageIssue('ISS-3');
    const card = findIssueById('ISS-3');
    assert.equal(card?.status, 'canceled');
    assert.equal(card?.triagedAt, FIXED_NOW);
  });
});
