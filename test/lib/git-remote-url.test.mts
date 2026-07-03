import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commitUrl, parseGitRemoteUrl } from '../../src/lib/git-remote-url.ts';

describe('parseGitRemoteUrl', () => {
  it('parses SSH github URLs', () => {
    const parsed = parseGitRemoteUrl('git@github.com:acme/widget.git');
    assert.deepEqual(parsed, {
      host: 'github.com',
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('parses HTTPS github URLs', () => {
    const parsed = parseGitRemoteUrl('https://github.com/acme/widget.git');
    assert.deepEqual(parsed, {
      host: 'github.com',
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('returns null for unparseable input', () => {
    assert.equal(parseGitRemoteUrl('not-a-remote'), null);
  });
});

describe('commitUrl', () => {
  it('builds a GitHub commit URL', () => {
    const url = commitUrl('git@github.com:acme/widget.git', 'abc123def456');
    assert.equal(url, 'https://github.com/acme/widget/commit/abc123def456');
  });

  it('returns null when remote cannot be parsed', () => {
    assert.equal(commitUrl('not-a-remote', 'abc123'), null);
  });
});
