/**
 * Pure Issues Git helpers (MIN-261 Phase 4).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildIssueCommitGrepCommand,
  buildIssuePrBody,
  buildIssuePrTitle,
  extractFirstHttpUrl,
  issueBranchName,
  issueCommitGrepNeedle,
  normalizeCommitSha,
  parseGhVersionAvailable,
  parseGitHubIssueOrPrUrl,
  parseGitLogOneline,
  slugifyIssueTitle,
} from '../../src/chat/issues/git-helpers.ts';
import type { IssueCard } from '../../src/types.ts';

describe('slugifyIssueTitle', () => {
  test('lowercases and hyphenates', () => {
    assert.equal(slugifyIssueTitle('Fix the Flaky Test!'), 'fix-the-flaky-test');
  });

  test('falls back when empty', () => {
    assert.equal(slugifyIssueTitle('   '), 'issue');
  });

  test('truncates long titles', () => {
    const slug = slugifyIssueTitle('a'.repeat(80), 20);
    assert.equal(slug.length, 20);
  });
});

describe('issueBranchName', () => {
  test('Linear-style issue/iss-n-slug', () => {
    assert.equal(
      issueBranchName('ISS-42', 'Wire Git menu'),
      'issue/iss-42-wire-git-menu',
    );
  });
});

describe('issueCommitGrepNeedle', () => {
  test('wraps id in brackets', () => {
    assert.equal(issueCommitGrepNeedle('ISS-42'), '[ISS-42]');
  });
});

describe('parseGitLogOneline', () => {
  test('parses sha and subject', () => {
    const rows = parseGitLogOneline(
      'abc1234 Fix flaky test [ISS-42]\ndef56789 Another line\n(exit 0)\n',
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sha, 'abc1234');
    assert.equal(rows[0].subject, 'Fix flaky test [ISS-42]');
    assert.equal(rows[1].sha, 'def56789');
  });

  test('skips Error lines', () => {
    assert.deepEqual(parseGitLogOneline('Error: not a git repo\n'), []);
  });
});

describe('normalizeCommitSha', () => {
  test('accepts short and full hex', () => {
    assert.equal(normalizeCommitSha('Abc1234'), 'abc1234');
    assert.equal(normalizeCommitSha('a'.repeat(40)), 'a'.repeat(40));
  });

  test('rejects junk', () => {
    assert.equal(normalizeCommitSha('not-a-sha'), null);
    assert.equal(normalizeCommitSha('abc'), null);
  });
});

describe('parseGitHubIssueOrPrUrl', () => {
  test('parses pull request URL', () => {
    const p = parseGitHubIssueOrPrUrl('https://github.com/acme/widget/pull/12');
    assert.ok(p);
    assert.equal(p!.kind, 'pr');
    assert.equal(p!.ref, '12');
    assert.equal(p!.url, 'https://github.com/acme/widget/pull/12');
  });

  test('parses issue URL with hash fragment', () => {
    const p = parseGitHubIssueOrPrUrl('https://github.com/acme/widget/issues/99#issuecomment-1');
    assert.ok(p);
    assert.equal(p!.kind, 'github-issue');
    assert.equal(p!.ref, '99');
    assert.equal(p!.url, 'https://github.com/acme/widget/issues/99');
  });

  test('rejects non-GitHub hosts', () => {
    assert.equal(parseGitHubIssueOrPrUrl('https://gitlab.com/acme/widget/issues/1'), null);
  });
});

describe('buildIssueCommitGrepCommand', () => {
  test('uses fixed-strings grep', () => {
    const cmd = buildIssueCommitGrepCommand('ISS-7', 20);
    assert.match(cmd, /--fixed-strings/);
    assert.match(cmd, /--grep="\[ISS-7\]"/);
    assert.match(cmd, /-n 20/);
  });
});

describe('PR title and body', () => {
  const issue = {
    id: 'ISS-42',
    type: 'bug',
    title: 'Fix flaky test',
    description: 'Repro steps here',
    status: 'todo',
    priority: 'high',
    labels: [],
    workspacePath: '/tmp',
    createdAt: 1,
    updatedAt: 1,
    planPath: 'documentation/plans/issues/ISS-42.md',
    codeRefs: [{ path: 'src/foo.ts', startLine: 10, endLine: 12 }],
  } as IssueCard;

  test('title includes id', () => {
    assert.equal(buildIssuePrTitle(issue), 'ISS-42: Fix flaky test');
  });

  test('body includes description and plan', () => {
    const body = buildIssuePrBody(issue);
    assert.match(body, /Repro steps here/);
    assert.match(body, /documentation\/plans\/issues\/ISS-42\.md/);
    assert.match(body, /src\/foo\.ts:10-12/);
  });
});

describe('parseGhVersionAvailable', () => {
  test('true for gh version exit 0', () => {
    assert.equal(parseGhVersionAvailable('gh version 2.40.0 (2024-01-01)\n(exit 0)\n'), true);
  });

  test('false for missing command', () => {
    assert.equal(parseGhVersionAvailable("Error: 'gh' is not recognized\n"), false);
    assert.equal(parseGhVersionAvailable('gh: command not found\n(exit 127)\n'), false);
  });
});

describe('extractFirstHttpUrl', () => {
  test('pulls PR URL from gh output', () => {
    assert.equal(
      extractFirstHttpUrl('Creating pull request\nhttps://github.com/acme/widget/pull/3\n'),
      'https://github.com/acme/widget/pull/3',
    );
  });
});
