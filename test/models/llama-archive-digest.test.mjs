/**
 * llama.cpp release-zip digest check — hardcoded fixture bytes + known sha256.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assertArchiveDigest } from '../../server/models/llama-runtime.js';

/** UTF-8 `minnow-llama-archive-fixture` — digest computed once, stored as a literal. */
const FIXTURE = Buffer.from('minnow-llama-archive-fixture', 'utf8');
const FIXTURE_SHA256 = 'd6141e4cc689c481edfae51805400cafa7d881d0380bae44589723ab2acb251e';

describe('assertArchiveDigest', () => {
  test('matching sha256 passes (with and without sha256: prefix)', async () => {
    await assertArchiveDigest(FIXTURE, FIXTURE_SHA256);
    await assertArchiveDigest(FIXTURE, `sha256:${FIXTURE_SHA256}`);
  });

  test('corrupted bytes throw and must not extract', async () => {
    const corrupted = Buffer.from('minnow-llama-archive-FIXTURE', 'utf8');
    await assert.rejects(
      () => assertArchiveDigest(corrupted, `sha256:${FIXTURE_SHA256}`),
      /sha256 mismatch/,
    );
  });

  test('missing digest skips verify so older GitHub API fixtures still work', async () => {
    await assertArchiveDigest(FIXTURE, null);
    await assertArchiveDigest(FIXTURE, '');
    await assertArchiveDigest(FIXTURE, undefined);
  });
});
