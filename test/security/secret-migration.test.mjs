/**
 * Provider secrets migration tests (plaintext → encrypted at rest).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { buildAuthHeaders, secretsFlags } from '../../server/providers/auth-headers.js';
import { getProviderRuntime, listProviders } from '../../server/providers/store.js';
import { isEncryptedSecretPayload, resetSecretBoxCacheForTests } from '../../server/security/secret-box.js';

const PROVIDER_ID = 'test-provider-fixed';
const PLAINTEXT_SECRETS = {
  apiKey: 'sk-migration-fixed-key',
  bearerToken: '',
  headerOverrides: { 'X-Test-Override': 'override-fixed' },
};

function setTestHome() {
  resetMinnowHomeCache();
  resetSecretBoxCacheForTests();
  const dir = path.join('/tmp', `minnow-secret-migration-${process.pid}-${Date.now()}`);
  process.env.MINNOW_HOME = dir;
  return dir;
}

async function rmTestHome(dir) {
  resetMinnowHomeCache();
  resetSecretBoxCacheForTests();
  delete process.env.MINNOW_HOME;
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function seedProvider(home) {
  const dir = path.join(home, 'providers', PROVIDER_ID);
  await fs.mkdir(dir, { recursive: true });
  const now = '2026-01-01T00:00:00.000Z';
  await fs.writeFile(
    path.join(dir, 'profile.json'),
    `${JSON.stringify(
      {
        id: PROVIDER_ID,
        label: 'Test Provider',
        baseUrl: 'http://127.0.0.1:1234',
        apiKind: 'openai-v1',
        enabled: true,
        authStyle: 'bearer',
        modelsPath: '/v1/models',
        chatCompletionsPath: '/v1/chat/completions',
        customHeaders: {},
        createdAt: now,
        updatedAt: now,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, 'secrets.json'),
    `${JSON.stringify(PLAINTEXT_SECRETS, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(home, 'config.json'),
    `${JSON.stringify({ schemaVersion: 1, activeProviderId: PROVIDER_ID }, null, 2)}\n`,
    'utf8',
  );
}

describe('provider secrets migration', () => {
  /** @type {string | undefined} */
  let home;

  beforeEach(async () => {
    home = setTestHome();
    await seedProvider(home);
  });

  afterEach(async () => {
    if (home) await rmTestHome(home);
  });

  test('plaintext secrets.json migrates to encrypted on read', async () => {
    const secretsPath = path.join(home, 'providers', PROVIDER_ID, 'secrets.json');
    const before = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
    assert.equal(isEncryptedSecretPayload(before), false);

    const { providers } = await listProviders();
    const row = providers.find((p) => p.id === PROVIDER_ID);
    assert.ok(row);
    assert.equal(row.hasApiKey, true);
    assert.equal(row.hasBearer, false);

    const after = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
    assert.equal(isEncryptedSecretPayload(after), true);
  });

  test('auth headers still work after migration', async () => {
    await listProviders();
    const runtime = await getProviderRuntime(PROVIDER_ID);
    const expectedHeaders = {
      Authorization: 'Bearer sk-migration-fixed-key',
      'X-Test-Override': 'override-fixed',
    };
    assert.deepEqual(buildAuthHeaders(runtime.profile, runtime.secrets), expectedHeaders);
    assert.deepEqual(secretsFlags(runtime.secrets), { hasApiKey: true, hasBearer: false });
  });

  test('corrupt encrypted secrets fail without leaking values', async () => {
    await listProviders();
    const secretsPath = path.join(home, 'providers', PROVIDER_ID, 'secrets.json');
    const envelope = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    envelope.ciphertext = bytes.toString('base64');
    await fs.writeFile(secretsPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

    await assert.rejects(
      () => getProviderRuntime(PROVIDER_ID),
      (err) => {
        assert.match(String(err.message), /could not be decrypted/i);
        assert.ok(!String(err.message).includes('sk-migration-fixed-key'));
        return true;
      },
    );
  });
});
