/**
 * Brain wiki store CRUD, wikilinks, backlinks, and bootstrap seeds.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { ensureMinnowLayout } from '../../server/config/home.js';
import {
  getBrainDir,
  getBrainIndexPath,
  getBrainLogPath,
  getBrainSchemaPath,
  getCatalogPath,
} from '../../server/brain/paths.js';
import {
  computeBacklinks,
  createPage,
  deletePage,
  ensureBrainStore,
  extractWikilinks,
  findOrphanPages,
  listPages,
  readPage,
  updatePage,
} from '../../server/brain/store.js';

const PAGE_ID = '11111111-1111-1111-1111-111111111111';
const PAGE_ID_B = '22222222-2222-2222-2222-222222222222';
const CREATED_AT = '2024-01-15T10:00:00.000Z';
const UPDATED_AT = '2024-02-01T12:30:00.000Z';

let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-store-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await ensureMinnowLayout();
});

after(async () => {
  closeCodeDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('brain store bootstrap', () => {
  test('ensureBrainStore seeds index, log, schema, and catalog', async () => {
    await ensureBrainStore();
    const index = await fs.readFile(getBrainIndexPath(), 'utf8');
    const log = await fs.readFile(getBrainLogPath(), 'utf8');
    const schema = await fs.readFile(getBrainSchemaPath(), 'utf8');
    const catalog = JSON.parse(await fs.readFile(getCatalogPath(), 'utf8'));
    assert.match(index, /Brain Wiki Index/);
    assert.match(log, /Brain Changelog/);
    assert.match(schema, /Brain Routing Schema/);
    assert.equal(catalog.version, 1);
    assert.ok(Array.isArray(catalog.pages));
    await fs.access(path.join(getBrainDir(), 'sources'));
    await fs.access(path.join(getBrainDir(), 'code'));
    await fs.access(path.join(getBrainDir(), 'pages', 'facts'));
    await fs.access(path.join(getBrainDir(), 'pages', 'workspaces'));
  });
});

describe('brain page CRUD', () => {
  test('create read update delete round-trip in nested paths', async () => {
    const created = await createPage({
      relPath: 'facts/preferred-command.md',
      id: PAGE_ID,
      title: 'Preferred test command',
      tags: ['testing'],
      source: 'user',
      pinned: true,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      body: 'Always run npm start before API smoke tests.',
    });
    assert.equal(created.meta.id, PAGE_ID);
    assert.equal(created.meta.folder, 'facts');
    assert.equal(created.meta.slug, 'preferred-command');

    const read = await readPage('facts/preferred-command.md');
    assert.equal(read.body, 'Always run npm start before API smoke tests.');
    assert.deepEqual(read.meta.tags, ['testing']);

    const domain = await createPage({
      relPath: 'minnow/architecture/overview.md',
      id: PAGE_ID_B,
      title: 'Architecture overview',
      body: 'See [[facts/preferred-command]] for commands.',
    });
    assert.equal(domain.meta.folder, 'minnow/architecture');

    const updated = await updatePage('facts/preferred-command.md', {
      title: 'Preferred command (updated)',
      body: 'Updated body with [[minnow/architecture/overview]].',
    });
    assert.equal(updated.meta.title, 'Preferred command (updated)');
    assert.ok(updated.meta.updatedAt > UPDATED_AT);

    const pages = await listPages();
    assert.equal(pages.length, 2);

    await deletePage('facts/preferred-command.md');
    await deletePage('minnow/architecture/overview.md');
    assert.equal((await listPages()).length, 0);
  });
});

describe('wikilinks backlinks orphans', () => {
  test('extracts path-based wikilinks and computes backlinks', () => {
    const links = extractWikilinks('Alpha [[facts/a]] and [[minnow/b]] again [[facts/a]].');
    assert.deepEqual(links, ['facts/a', 'minnow/b']);

    const catalog = {
      pages: [
        { path: 'facts/a.md', links: ['minnow/b'], status: 'current' },
        { path: 'minnow/b.md', links: ['facts/a'], status: 'current' },
        { path: 'facts/orphan.md', links: [], status: 'orphan' },
      ],
    };
    const backlinks = computeBacklinks(catalog);
    assert.deepEqual(backlinks['minnow/b'], ['facts/a.md']);

    const orphans = findOrphanPages(catalog);
    const orphanPaths = orphans.map((p) => p.path).sort();
    assert.deepEqual(orphanPaths, ['facts/orphan.md']);
    assert.equal(backlinks['facts/a'].length, 1);
  });
});
