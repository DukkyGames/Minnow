/**
 * rebuildCatalog reconstructs catalog.json from disk alone.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { getCatalogPath } from '../../server/brain/paths.js';
import {
  createPage,
  loadCatalog,
  rebuildCatalog,
  serializePage,
} from '../../server/brain/store.js';
import { resolvePagePath } from '../../server/brain/paths.js';

const PAGE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-catalog-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
});

after(async () => {
  closeCodeDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('brain catalog rebuild', () => {
  test('rebuildCatalog restores metadata after catalog.json is deleted', async () => {
    await createPage({
      relPath: 'facts/direct-write.md',
      id: PAGE_ID,
      title: 'Direct write',
      body: 'Body from CRUD.',
    });

    await fs.unlink(getCatalogPath());
    const before = await loadCatalog();
    assert.equal(before.pages.length, 0);

    const rebuilt = await rebuildCatalog();
    assert.equal(rebuilt.pages.length, 1);
    assert.equal(rebuilt.pages[0].id, PAGE_ID);
    assert.equal(rebuilt.pages[0].path, 'facts/direct-write.md');
    assert.ok(rebuilt.generatedAt);

    const abs = await resolvePagePath('facts/manual-page.md');
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(
      abs,
      serializePage(
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          title: 'Manual page',
          tags: [],
          source: 'user',
          summary: '',
          pinned: false,
          createdAt: '2024-03-01T00:00:00.000Z',
          updatedAt: '2024-03-01T00:00:00.000Z',
          anchors: [],
          status: 'current',
          input_hash: '',
        },
        'Written without catalog.',
      ),
      'utf8',
    );

    const second = await rebuildCatalog();
    assert.equal(second.pages.length, 2);
    const manual = second.pages.find((p) => p.slug === 'manual-page');
    assert.equal(manual.title, 'Manual page');
    assert.equal(manual.links.length, 0);
  });
});
