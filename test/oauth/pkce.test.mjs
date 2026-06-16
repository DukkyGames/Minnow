/**
 * PKCE helper tests (deterministic challenge).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  codeChallengeFromVerifier,
  createPkcePair,
  randomUrlSafeString,
} from '../../server/oauth/pkce.js';

describe('oauth pkce', () => {
  test('codeChallengeFromVerifier is stable for a fixed verifier', () => {
    const verifier = 'test-verifier-abcdefghijklmnopqrstuvwxyz';
    const challenge = codeChallengeFromVerifier(verifier);
    assert.equal(challenge, codeChallengeFromVerifier(verifier));
    assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  });

  test('createPkcePair returns matching S256 challenge', () => {
    const pair = createPkcePair();
    assert.equal(pair.codeChallenge, codeChallengeFromVerifier(pair.codeVerifier));
  });

  test('randomUrlSafeString has expected length', () => {
    const value = randomUrlSafeString(16);
    assert.ok(value.length >= 16);
  });
});
