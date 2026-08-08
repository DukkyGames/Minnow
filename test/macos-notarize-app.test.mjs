import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isTransientNotarizeUploadError,
  notarytoolAuthorizationArgs,
  TRANSIENT_NOTARIZE_UPLOAD_RE,
} from '../scripts/macos-notarize-app.mjs';

describe('macos-notarize-app', () => {
  it('detects transient notarytool upload errors', () => {
    const sample =
      'Error: abortedUpload(..., error: HTTPClientError.deadlineExceeded)';
    assert.ok(TRANSIENT_NOTARIZE_UPLOAD_RE.test(sample));
    assert.ok(isTransientNotarizeUploadError(sample));
    assert.equal(isTransientNotarizeUploadError('Invalid status: Rejected'), false);
  });

  it('builds Apple ID auth args from env', () => {
    const keys = [
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
      'APPLE_KEYCHAIN_PROFILE',
    ];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      process.env.APPLE_ID = 'dev@example.com';
      process.env.APPLE_APP_SPECIFIC_PASSWORD = 'abcd-efgh';
      process.env.APPLE_TEAM_ID = 'TEAMID1234';
      delete process.env.APPLE_API_KEY;
      delete process.env.APPLE_API_KEY_ID;
      delete process.env.APPLE_API_ISSUER;
      delete process.env.APPLE_KEYCHAIN_PROFILE;

      assert.deepEqual(notarytoolAuthorizationArgs(), [
        '--apple-id',
        'dev@example.com',
        '--password',
        'abcd-efgh',
        '--team-id',
        'TEAMID1234',
      ]);
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});
