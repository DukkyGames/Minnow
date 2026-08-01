/**
 * resolveRepoKey + ensureWarmCodeIndex behavior.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveRepoKey } from '../../../server/brain/code/query.js';

describe('resolveRepoKey', () => {
  it('rejects invalid slug characters', () => {
    assert.throws(
      () => resolveRepoKey('../escape'),
      (err) => err instanceof Error && err.message === 'Invalid repo key',
    );
  });

  it('lowercases valid keys', () => {
    assert.equal(resolveRepoKey('My-Repo_1'), 'my-repo_1');
  });
});
