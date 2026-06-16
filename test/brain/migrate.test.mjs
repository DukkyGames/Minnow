/**
 * Memory → brain migration: id/timestamp/vector preservation and idempotency.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { getEntriesDir, getIndexPath, getMemoryDir } from '../../server/memory/paths.js';
import { getBrainDir, getBrainStatePath, getCatalogPath } from '../../server/brain/paths.js';
import { getEnginePaths as getBrainEnginePaths } from '../../server/brain/engine-paths.js';
import {
  isMigratedFromMemory,
  migrateFromMemory,
} from '../../server/brain/migrate.js';
import { ensureBrainLayout, loadCatalog, rebuildCatalog } from '../../server/brain/store.js';

const ENTRY_A = '11111111-1111-1111-1111-111111111111';
const ENTRY_B = '22222222-2222-2222-2222-222222222222';
const CREATED_A = '2023-06-01T08:00:00.000Z';
const UPDATED_A = '2023-07-10T09:15:00.000Z';
const CREATED_B = '2023-08-02T10:00:00.000Z';
const UPDATED_B = '2023-09-03T11:00:00.000Z';

let homeDir;

async function seedMemoryStore() {
  await fs.mkdir(getEntriesDir(), { recursive: true });
  const index = {
    version: 1,
    entries: [
      {
        id: ENTRY_A,
        title: 'Preferred test command',
        tags: ['cli'],
        source: 'user',
        pinned: true,
        createdAt: CREATED_A,
        updatedAt: UPDATED_A,
      },
      {
        id: ENTRY_B,
        title: 'Agent note',
        tags: [],
        source: 'agent',
        pinned: false,
        createdAt: CREATED_B,
        updatedAt: UPDATED_B,
      },
    ],
  };
  await fs.writeFile(getIndexPath(), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    path.join(getEntriesDir(), `${ENTRY_A}.md`),
    `---
id: "${ENTRY_A}"
title: "Preferred test command"
tags: [cli]
source: user
---

Always run npm start.`,
    'utf8',
  );
  await fs.writeFile(
    path.join(getEntriesDir(), `${ENTRY_B}.md`),
    `---
id: "${ENTRY_B}"
title: "Agent note"
tags: []
source: agent
---

Remember the architecture.`,
    'utf8',
  );
  const vectors = {
    version: 1,
    model: 'test-model',
    backend: 'local',
    dim: 2,
    vectors: {
      [ENTRY_A]: [0.6, 0.8],
      [ENTRY_B]: [1, 0],
    },
  };
  await fs.writeFile(
    path.join(getMemoryDir(), 'vectors.json'),
    `${JSON.stringify(vectors, null, 2)}\n`,
    'utf8',
  );
}

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-migrate-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await ensureBrainLayout();
  await seedMemoryStore();
});

after(async () => {
  closeCodeDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('brain memory migration', () => {
  test('migrates entries preserving ids, timestamps, and vectors', async () => {
    const first = await migrateFromMemory();
    assert.equal(first.migrated, true);
    assert.equal(first.entryCount, 2);
    assert.equal(await isMigratedFromMemory(), true);

    const catalog = await rebuildCatalog();
    const ids = catalog.pages.map((p) => p.id).sort();
    assert.deepEqual(ids, [ENTRY_A, ENTRY_B].sort());

    const pageA = catalog.pages.find((p) => p.id === ENTRY_A);
    assert.equal(pageA.createdAt, CREATED_A);
    assert.equal(pageA.updatedAt, UPDATED_A);
    assert.equal(pageA.folder, 'facts');
    assert.match(pageA.path, /^facts\/preferred-test-command/);

    const brainVectors = JSON.parse(
      await fs.readFile(getBrainEnginePaths().vectorsPath, 'utf8'),
    );
    assert.deepEqual(brainVectors.vectors[ENTRY_A], [0.6, 0.8]);
    assert.deepEqual(brainVectors.vectors[ENTRY_B], [1, 0]);

    const state = JSON.parse(await fs.readFile(getBrainStatePath(), 'utf8'));
    assert.equal(state.migratedFromMemory, true);
    assert.equal(state.entryCount, 2);

    const backupsDir = path.join(homeDir, 'backups');
    const backups = await fs.readdir(backupsDir);
    assert.ok(backups.some((name) => name.startsWith('memory-')));
  });

  test('running migration twice is a no-op', async () => {
    const catalogBefore = await loadCatalog();
    const second = await migrateFromMemory();
    assert.equal(second.migrated, false);
    assert.equal(second.reason, 'already-migrated');
    const catalogAfter = await loadCatalog();
    assert.deepEqual(catalogAfter.pages, catalogBefore.pages);
  });
});
