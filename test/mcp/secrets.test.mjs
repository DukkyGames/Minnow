import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  getContext7ApiKey,
  readMcpSecrets,
  resolveMcpTransportEnv,
  updateMcpSecrets,
} from '../../server/mcp/secrets.js';
import { reloadMcp } from '../../server/mcp/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('MCP secrets', () => {
  let homeDir;
  let previousKey;

  before(async () => {
    homeDir = path.join(__dirname, '../fixtures/mcp-secrets-home');
    previousKey = process.env.CONTEXT7_API_KEY;
    delete process.env.CONTEXT7_API_KEY;
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  after(async () => {
    if (previousKey === undefined) {
      delete process.env.CONTEXT7_API_KEY;
    } else {
      process.env.CONTEXT7_API_KEY = previousKey;
    }
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await reloadMcp();
  });

  test('update and read Context7 API key', async () => {
    const flags = await updateMcpSecrets({ context7ApiKey: 'ctx7-test-key' });
    assert.equal(flags.hasContext7ApiKey, true);

    const secrets = await readMcpSecrets();
    assert.equal(secrets.context7ApiKey, 'ctx7-test-key');
    assert.equal(await getContext7ApiKey(), 'ctx7-test-key');
  });

  test('clear Context7 API key', async () => {
    const flags = await updateMcpSecrets({ context7ApiKey: '' });
    assert.equal(flags.hasContext7ApiKey, false);
    assert.equal(await getContext7ApiKey(), '');
  });

  test('resolve ${secret:context7ApiKey} in transport env', async () => {
    await updateMcpSecrets({ context7ApiKey: 'resolved-key' });
    const env = await resolveMcpTransportEnv({
      CONTEXT7_API_KEY: '${secret:context7ApiKey}',
      PLAIN: 'literal',
    });
    assert.equal(env.CONTEXT7_API_KEY, 'resolved-key');
    assert.equal(env.PLAIN, 'literal');
  });

  test('process env CONTEXT7_API_KEY takes precedence', async () => {
    await updateMcpSecrets({ context7ApiKey: 'stored-key' });
    process.env.CONTEXT7_API_KEY = 'env-key';
    assert.equal(await getContext7ApiKey(), 'env-key');
    delete process.env.CONTEXT7_API_KEY;
  });
});
