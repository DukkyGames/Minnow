import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildGitCommitMessagePrompt,
  sanitizeCommitMessage,
  truncateStagedPatch,
} from '../../src/ui/git-commit-message-client.ts';

describe('truncateStagedPatch', () => {
  test('returns patch unchanged when under limit', () => {
    const patch = 'diff --git a/foo.ts b/foo.ts\n+hello';
    assert.equal(truncateStagedPatch(patch, 100), patch);
  });

  test('appends truncation marker when over limit', () => {
    const patch = 'x'.repeat(120);
    const out = truncateStagedPatch(patch, 50);
    assert.ok(out.startsWith('x'.repeat(50)));
    assert.match(out, /diff truncated/);
  });
});

describe('buildGitCommitMessagePrompt', () => {
  test('includes changed file list and diff in user message', () => {
    const messages = buildGitCommitMessagePrompt(['src/a.ts', 'src/b.ts'], '+added line');
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    const user = String(messages[1].content);
    assert.match(user, /src\/a\.ts/);
    assert.match(user, /src\/b\.ts/);
    assert.match(user, /\+added line/);
  });
});

describe('sanitizeCommitMessage', () => {
  test('strips markdown fences', () => {
    assert.equal(
      sanitizeCommitMessage('```\nfeat: add widget\n```'),
      'feat: add widget',
    );
  });

  test('strips wrapping quotes and prefixes', () => {
    assert.equal(sanitizeCommitMessage('"feat: ship it"'), 'feat: ship it');
    assert.equal(sanitizeCommitMessage('Commit message: fix: bug'), 'fix: bug');
  });

  test('preserves multiline body', () => {
    const raw = 'feat: add panel\n\nExplain why this matters.';
    assert.equal(sanitizeCommitMessage(raw), raw);
  });
});
