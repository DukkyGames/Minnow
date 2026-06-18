/**
 * Reindex scope: all brain wiki pages, not only legacy facts/ memory entries.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { createPage } from '../../server/brain/store.js';
import { loadAllPagesWithBodies } from '../../server/brain/retrieve.js';
import { initMemoryApi } from '../../server/memory/routes.js';
import { loadAllEntriesWithBodies } from '../../server/memory/store.js';
import {
  clearReindexNeeded,
  markReindexNeeded,
} from '../../server/memory/vector-sync.js';
import { loadMemoryConfig } from '../../server/memory/store.js';

let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-reindex-scope-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();

  const configPath = path.join(homeDir, 'config.json');
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        memory: {
          enabled: true,
          embeddings: {
            enabled: true,
            backend: 'local',
            modelId: 'fixture-model',
            reindexNeeded: true,
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await initMemoryApi();
});

after(async () => {
  closeCodeDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('embeddings reindex scope', () => {
  test('loadAllPagesWithBodies includes non-facts wiki pages', async () => {
    await createPage({
      relPath: 'projects/reindex-scope.md',
      title: 'Project note',
      body: 'Wiki page outside facts/.',
      tags: ['wiki'],
    });

    const memoryEntries = await loadAllEntriesWithBodies();
    const wikiPages = await loadAllPagesWithBodies();

    assert.equal(memoryEntries.length, 0);
    assert.equal(wikiPages.length, 1);
  });

  test('clearReindexNeeded clears memory.embeddings.reindexNeeded', async () => {
    await markReindexNeeded();
    let config = await loadMemoryConfig();
    assert.equal(config.embeddings?.reindexNeeded, true);

    await clearReindexNeeded();
    config = await loadMemoryConfig();
    assert.equal(config.embeddings?.reindexNeeded, false);
  });
});
