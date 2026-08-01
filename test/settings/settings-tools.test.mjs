/**
 * Settings agent tools — registry coverage, read redaction, write validation.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { SETTINGS_FIELD_CATALOG } from '../../src/ui/settings-catalog.ts';
import { getFieldByKey, buildStaticFieldRegistry } from '../../src/settings/field-registry.ts';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { readResource } from '../../server/config/store.js';
import { executeServerTool } from '../../server/runtime/tools-middleware.js';
import { shutdownAllLsp } from '../../server/lsp/manager.js';

describe('settings agent tools', () => {
  let homeDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-settings-tools-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  after(async () => {
    shutdownAllLsp();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('every SETTINGS_FIELD_CATALOG key has a registry entry', () => {
    const staticRegistry = buildStaticFieldRegistry();
    const keys = new Set(staticRegistry.map((f) => f.key));
    for (const entry of SETTINGS_FIELD_CATALOG) {
      assert.ok(keys.has(entry.key), `missing registry entry for ${entry.key}`);
    }
  });

  it('search_settings returns matching catalog metadata', async () => {
    const out = await executeServerTool('search_settings', { query: 'network' });
    assert.match(out.result, /general\.network/);
    assert.doesNotMatch(out.result, /"value"/);
  });

  it('get_settings redacts search API keys', async () => {
    const search = await readResource('search');
    search.keys = { braveApiKey: 'secret-brave-key', tavilyApiKey: 'secret-tavily' };
    const { writeResource } = await import('../../server/config/store.js');
    await writeResource('search', search);

    const out = await executeServerTool('get_settings', {
      keys: ['integrations.search.apiKeys'],
    });
    assert.match(out.result, /\[redacted\]/);
    assert.doesNotMatch(out.result, /secret-brave/);
  });

  it('update_settings rejects invalid enum without persisting', async () => {
    const before = await readResource('meta');
    const out = await executeServerTool('update_settings', {
      changes: [{ key: 'general.network', value: 'invalid-mode' }],
      confirmed: true,
    });
    assert.match(out.result, /Invalid value/i);
    const after = await readResource('meta');
    assert.equal(after.server?.networkAccess, before.server?.networkAccess);
  });

  it('update_settings requires confirmed for dangerous fields', async () => {
    const out = await executeServerTool('update_settings', {
      changes: [{ key: 'general.network', value: 'lan' }],
    });
    assert.match(out.result, /confirmed/i);
  });

  it('update_settings applies meta patch when confirmed', async () => {
    const out = await executeServerTool('update_settings', {
      changes: [{ key: 'integrations.search.provider', value: 'duckduckgo' }],
      confirmed: true,
    });
    assert.match(out.result, /"applied"/);
    const search = await readResource('search');
    assert.equal(search.provider, 'duckduckgo');
  });

  it('registry marks secret fields', () => {
    const field = getFieldByKey('integrations.search.apiKeys');
    assert.equal(field?.sensitivity, 'secret');
  });

  // Without the education branch in mergeConfigMeta the PUT is silently dropped.
  it('education block survives mergeConfigMeta', async () => {
    const { writeResource } = await import('../../server/config/store.js');
    await writeResource('meta', { education: { enabled: true, level: 'advanced' } });
    const meta = await readResource('meta');
    assert.equal(meta.education?.enabled, true);
    assert.equal(meta.education?.level, 'advanced');

    // Partial patches must not clobber the sibling key.
    await writeResource('meta', { education: { level: 'intermediate' } });
    const after = await readResource('meta');
    assert.equal(after.education?.enabled, true);
    assert.equal(after.education?.level, 'intermediate');
  });

  it('education block rejects an unknown level', async () => {
    const { writeResource } = await import('../../server/config/store.js');
    await writeResource('meta', { education: { level: 'expert' } });
    const meta = await readResource('meta');
    assert.notEqual(meta.education?.level, 'expert');
  });

  it('update_settings cannot switch Education Mode off', async () => {
    const { writeResource } = await import('../../server/config/store.js');
    await writeResource('meta', { education: { enabled: true, level: 'beginner' } });

    const out = await executeServerTool('update_settings', {
      changes: [{ key: 'general.education.enabled', value: false }],
      confirmed: true,
    });
    assert.match(out.result, /skipped/i);
    assert.match(out.result, /not writable/i);

    const meta = await readResource('meta');
    assert.equal(meta.education?.enabled, true);
  });

  it('get_settings still reports Education Mode so the agent knows it is teaching', async () => {
    const out = await executeServerTool('get_settings', {
      keys: ['general.education.enabled'],
    });
    assert.match(out.result, /general\.education\.enabled/);
  });
});
