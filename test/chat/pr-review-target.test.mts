/**
 * Pure PR identity helpers: key format, branch matching, issue PR precedence.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  matchPrForBranch,
  prReviewKey,
  resolveIssuePrRef,
} from '../../src/chat/review/pr-review-target.ts';
import type { PullRequestSummary } from '../../src/state/forge-api.ts';
import type { IssueCard } from '../../src/types.ts';

function pr(partial: Partial<PullRequestSummary> & { number: number; headRef: string }): PullRequestSummary {
  return {
    title: 't',
    state: 'open',
    draft: false,
    author: '',
    baseRef: 'main',
    createdAt: '',
    updatedAt: '',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    url: '',
    reviewDecision: '',
    mergeable: '',
    labels: [],
    checks: 'none',
    checkCount: 0,
    ...partial,
  };
}

describe('prReviewKey', () => {
  test('formats owner/name#number', () => {
    assert.equal(prReviewKey('acme/minnow', 12), 'acme/minnow#12');
  });
});

describe('matchPrForBranch', () => {
  test('returns the open PR whose headRef matches', () => {
    const match = matchPrForBranch(
      [
        pr({ number: 1, headRef: 'other', state: 'open' }),
        pr({ number: 2, headRef: 'feat/foo', state: 'open' }),
        pr({ number: 3, headRef: 'feat/foo', state: 'closed' }),
      ],
      'feat/foo',
    );
    assert.equal(match?.number, 2);
  });

  test('ignores closed PRs on the same branch', () => {
    const match = matchPrForBranch(
      [pr({ number: 9, headRef: 'feat/foo', state: 'merged' })],
      'feat/foo',
    );
    assert.equal(match, null);
  });

  test('returns null for an empty branch', () => {
    assert.equal(matchPrForBranch([pr({ number: 1, headRef: 'feat/foo' })], '  '), null);
  });
});

describe('resolveIssuePrRef', () => {
  test('prefers a git link over agent.prNumber', () => {
    const issue = {
      gitLinks: [{ kind: 'pr' as const, ref: '44', addedAt: 1, url: 'https://github.com/acme/minnow/pull/44' }],
      agent: { prNumber: 99, prUrl: 'https://github.com/acme/minnow/pull/99' },
    };
    const ref = resolveIssuePrRef(issue);
    assert.equal(ref?.number, 44);
    assert.equal(ref?.url, 'https://github.com/acme/minnow/pull/44');
  });

  test('falls back to agent.prNumber', () => {
    const issue = {
      gitLinks: [{ kind: 'branch' as const, ref: 'issue/iss-1', addedAt: 1 }],
      agent: { prNumber: 7, prUrl: 'https://github.com/acme/minnow/pull/7' },
    };
    const ref = resolveIssuePrRef(issue);
    assert.equal(ref?.number, 7);
    assert.equal(ref?.url, 'https://github.com/acme/minnow/pull/7');
  });

  test('returns null when nothing is stored', () => {
    assert.equal(resolveIssuePrRef({ gitLinks: [], agent: undefined } as Pick<IssueCard, 'gitLinks' | 'agent'>), null);
  });
});
