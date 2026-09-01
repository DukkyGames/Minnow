/**
 * Task envelope budget: small patches inline; large patches get a file table
 * plus the largest hunks that fit, and instructions to git-diff the rest.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  PR_REVIEW_PATCH_BUDGET,
  buildPrReviewTask,
  parsePatchFiles,
  type PrReviewContext,
} from '../../src/chat/review/pr-review-context.ts';
import type { PullRequestDetail } from '../../src/state/forge-api.ts';

function detail(partial: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    number: 12,
    title: 'Add review panel',
    state: 'open',
    draft: false,
    author: 'ada',
    headRef: 'feat/review',
    baseRef: 'main',
    createdAt: '',
    updatedAt: '',
    additions: 10,
    deletions: 2,
    changedFiles: 2,
    url: 'https://github.com/acme/minnow/pull/12',
    reviewDecision: '',
    mergeable: 'MERGEABLE',
    labels: [],
    checks: 'success',
    checkCount: 1,
    body: 'Ship the review button.',
    mergeStateStatus: 'CLEAN',
    crossRepository: false,
    files: [],
    commits: [{ sha: 'abc1234deadbeef', subject: 'Add panel', author: 'ada' }],
    reviews: [],
    statusChecks: [],
    ...partial,
  };
}

function filePatch(path: string, lines: number): string {
  const body = Array.from({ length: lines }, (_, i) => `+line ${i} of ${path}`).join('\n');
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,${lines} @@\n${body}\n`;
}

function ctx(patch: string): PrReviewContext {
  return { pr: detail(), patch, cwd: '/tmp/minnow' };
}

describe('parsePatchFiles', () => {
  test('splits unified diffs and counts plus/minus', () => {
    const patch = `${filePatch('src/a.ts', 3)}${filePatch('src/b.ts', 1)}`;
    const files = parsePatchFiles(patch);
    assert.equal(files.length, 2);
    assert.equal(files[0]?.path, 'src/a.ts');
    assert.equal(files[0]?.additions, 3);
    assert.equal(files[1]?.path, 'src/b.ts');
  });
});

describe('buildPrReviewTask', () => {
  test('inlines the full patch when under budget', () => {
    const patch = filePatch('src/ui/pr-review-panel.ts', 4);
    const task = buildPrReviewTask(ctx(patch));
    assert.match(task, /Review pull request #12/);
    assert.match(task, /feat\/review/);
    assert.match(task, /Add panel/);
    assert.match(task, /```diff/);
    assert.match(task, /pr-review-panel\.ts/);
    assert.doesNotMatch(task, /exceeds the task budget/);
  });

  test('emits a file table and per-file git diff instructions when over budget', () => {
    const big = filePatch('src/huge.ts', 20_000);
    const small = filePatch('src/tiny.ts', 2);
    assert.ok(big.length > PR_REVIEW_PATCH_BUDGET, 'fixture must exceed the budget');
    const task = buildPrReviewTask(ctx(big + small));
    assert.match(task, /exceeds the task budget/);
    assert.match(task, /src\/huge\.ts/);
    assert.match(task, /src\/tiny\.ts/);
    assert.match(task, /git diff main\.\.\.feat\/review -- <path>/);
  });
});
