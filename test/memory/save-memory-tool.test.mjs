/**
 * save_memory server tool — persists agent entries under MINNOW_HOME.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { initMemoryApi } from '../../server/memory/routes.js';
import { getEntry } from '../../server/memory/store.js';
import { toolSaveMemory } from '../../server/tools/memory-tools.js';

describe('save_memory tool', () => {
  let homeDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-save-memory-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await initMemoryApi();
    // save_memory schedules vector sync — disable embeddings so teardown does not
    // race fire-and-forget embedder I/O on Windows CI.
    const configPath = path.join(homeDir, 'config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.memory.embeddings.enabled = false;
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  });

  after(async () => {
    closeCodeDbForTests();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('creates an agent-sourced entry with fixed title and body', async () => {
    const result = await toolSaveMemory({
      title: 'Fixture preference',
      body: 'Always run tests with npm test.',
      tags: ['testing'],
    });
    assert.match(result, /Saved memory "Fixture preference"/);

    const idMatch = result.match(/\(id: ([0-9a-f-]{36})\)/i);
    assert.ok(idMatch, 'result includes entry id');
    const row = await getEntry(idMatch[1]);
    assert.ok(row);
    assert.equal(row.entry.title, 'Fixture preference');
    assert.equal(row.entry.source, 'agent');
    assert.equal(row.body, 'Always run tests with npm test.');
    assert.deepEqual(row.entry.tags, ['testing']);
  });

  it('returns error when title is missing', async () => {
    const result = await toolSaveMemory({ body: 'orphan body' });
    assert.match(result, /^Error: title is required/);
  });
});
