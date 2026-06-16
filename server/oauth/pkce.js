/**
 * PKCE helpers for OAuth 2.0 authorization code flows.
 */

import crypto from 'node:crypto';

/** Generate a URL-safe random string for PKCE verifier / state. */
export function randomUrlSafeString(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

/** S256 code challenge from verifier (RFC 7636). */
export function codeChallengeFromVerifier(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** Build a full PKCE pair for a new flow. */
export function createPkcePair() {
  const codeVerifier = randomUrlSafeString(32);
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);
  return { codeVerifier, codeChallenge };
}
