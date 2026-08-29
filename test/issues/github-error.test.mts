/**
 * GitHub import/sync error copy — never show raw server_off in the SPA (MIN-660).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { OPEN_MINNOW_RETRY } from '../../src/copy/local-session.ts';
import {
  isLocalServerOfflineError,
  userFacingGithubError,
} from '../../src/issues/github-error.ts';

describe('userFacingGithubError', () => {
  test('maps server_off and fetch failures to Open or restart Minnow', () => {
    assert.equal(userFacingGithubError('server_off'), OPEN_MINNOW_RETRY);
    assert.equal(userFacingGithubError('server OFF'), OPEN_MINNOW_RETRY);
    assert.equal(userFacingGithubError('server-off'), OPEN_MINNOW_RETRY);
    assert.equal(userFacingGithubError('Failed to fetch'), OPEN_MINNOW_RETRY);
    assert.equal(userFacingGithubError('NetworkError when attempting to fetch resource.'), OPEN_MINNOW_RETRY);
    assert.equal(userFacingGithubError('HTTP 503'), OPEN_MINNOW_RETRY);
    assert.equal(userFacingGithubError(''), OPEN_MINNOW_RETRY);
    assert.equal(userFacingGithubError(undefined), OPEN_MINNOW_RETRY);
  });

  test('passes through GitHub CLI and repo errors', () => {
    const signedOut = 'The GitHub CLI is not signed in. Run `gh auth login` to manage pull requests and CI.';
    assert.equal(userFacingGithubError(signedOut), signedOut);
    assert.equal(userFacingGithubError('GitHub sync is off'), 'GitHub sync is off');
  });

  test('maps gh/process timeouts to a retry hint', () => {
    assert.equal(
      userFacingGithubError('Command timed out after 45s'),
      'GitHub did not respond in time. Try again.',
    );
  });

  test('does not leak the issues-store boot throw', () => {
    assert.equal(
      userFacingGithubError('issuesState is not initialized; call loadIssuesFromStorage() first'),
      'Issues are still loading. Try again in a moment.',
    );
  });
});

describe('isLocalServerOfflineError', () => {
  test('recognizes internal codes and the user-facing retry sentence', () => {
    assert.equal(isLocalServerOfflineError('server_off'), true);
    assert.equal(isLocalServerOfflineError(OPEN_MINNOW_RETRY), true);
    assert.equal(isLocalServerOfflineError('Not a git repository'), false);
  });
});
