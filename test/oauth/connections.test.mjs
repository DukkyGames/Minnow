/**
 * OAuth connection store + secret-box round-trip.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  listOAuthConnections,
  readConnectionTokens,
  upsertOAuthConnection,
  deleteOAuthConnection,
  redactConnection,
} from '../../server/oauth/connections.js';
import { resetSecretBoxCacheForTests, setSecretKeyBytesForTests } from '../../server/security/secret-box.js';

/** @type {string} */
let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-oauth-conn-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  setSecretKeyBytesForTests(Buffer.from('dddddddddddddddddddddddddddddddd', 'utf8'));
});

after(async () => {
  resetSecretBoxCacheForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('oauth connections', () => {
  test('upsert and read encrypted tokens', async () => {
    const connection = await upsertOAuthConnection({
      provider: 'google',
      email: 'user@example.com',
      label: 'Work Gmail',
      services: { email: true, calendar: true },
      tokens: {
        accessToken: 'access-token-111',
        refreshToken: 'refresh-token-222',
        expiresAt: Date.now() + 3600_000,
        scopes: 'email calendar',
      },
    });

    assert.equal(connection.email, 'user@example.com');
    const redacted = redactConnection(connection);
    assert.equal(redacted.hasTokens, true);
    assert.equal('secretRef' in redacted, false);

    const tokens = await readConnectionTokens(connection.id);
    assert.equal(tokens.accessToken, 'access-token-111');
    assert.equal(tokens.refreshToken, 'refresh-token-222');

    const listed = await listOAuthConnections();
    assert.equal(listed.length, 1);

    await deleteOAuthConnection(connection.id);
    assert.equal((await listOAuthConnections()).length, 0);
  });
});
