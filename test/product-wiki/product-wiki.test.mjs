import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  loadProductWikiCatalog,
  readProductWikiPage,
  resolveProductWikiPagePath,
  searchProductWiki,
} from '../../server/product-wiki/catalog.js';
import {
  toolMinnowDocsList,
  toolMinnowDocsRead,
  toolMinnowDocsSearch,
} from '../../server/tools/minnow-docs-tools.js';
import {
  buildProductWikiCatalog,
  createProductWikiEntry,
  isProductWikiPath,
} from '../../scripts/product-wiki-catalog-lib.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('product wiki catalog generation', () => {
  test('includes public and maintainer docs while excluding working folders', () => {
    assert.equal(isProductWikiPath('guides/setup.md'), true);
    assert.equal(isProductWikiPath('maintainer/releasing.md'), true);
    assert.equal(isProductWikiPath('plans/example.md'), false);
    assert.equal(isProductWikiPath('memory/note.md'), false);
    assert.equal(isProductWikiPath('../README.md'), false);
  });

  test('extracts deterministic page metadata', () => {
    const entry = createProductWikiEntry(
      'guides/example.md',
      '# Example guide\n\nA short summary for readers.\n\n## Configure it\n\nDetails.',
    );
    assert.equal(entry.path, 'documentation/guides/example.md');
    assert.equal(entry.title, 'Example guide');
    assert.equal(entry.summary, 'A short summary for readers. Configure it Details.');
    assert.deepEqual(entry.headings, ['Configure it']);
    assert.equal(entry.section, 'Guides');
    assert.match(entry.hash, /^[a-f0-9]{64}$/u);
  });

  test('committed catalog covers every generated page', async () => {
    const generated = await buildProductWikiCatalog(path.join(repositoryRoot, 'documentation'));
    const committed = await loadProductWikiCatalog();
    assert.deepEqual(committed, generated);
    assert.ok(committed.entries.some((entry) => entry.path === 'documentation/guides/wiki.md'));
    assert.ok(committed.entries.some((entry) => entry.path === 'documentation/ROADMAP.md'));
  });
});

describe('product wiki reads and search', () => {
  test('reads an allowlisted official page', async () => {
    const page = await readProductWikiPage('documentation/guides/setup.md');
    assert.equal(page.path, 'documentation/guides/setup.md');
    assert.match(page.content, /^# /u);
  });

  test('rejects traversal and excluded documents', async () => {
    await assert.rejects(
      resolveProductWikiPagePath('documentation/../package.json'),
      /not found|path/iu,
    );
    await assert.rejects(
      resolveProductWikiPagePath('documentation/plans/MIN-406-unified-minnow-wiki.md'),
      /not found/iu,
    );
  });

  test('ranks exact title and heading matches with excerpts', async () => {
    const hits = await searchProductWiki('Minnow wiki', { limit: 4 });
    assert.ok(hits.length > 0);
    assert.equal(hits[0].path, 'documentation/guides/wiki.md');
    assert.ok(hits[0].excerpt.length > 0);
  });
});

describe('product wiki chat tools', () => {
  test('search, read, and list return citation paths', async () => {
    const searchResult = JSON.parse(await toolMinnowDocsSearch({ query: 'keyboard shortcuts' }));
    assert.ok(searchResult.hits.some((hit) => hit.path === 'documentation/guides/keyboard-shortcuts.md'));

    const readResult = await toolMinnowDocsRead({ path: 'documentation/ROADMAP.md' });
    assert.match(readResult, /Source: documentation\/ROADMAP\.md/u);
    assert.match(readResult, /# Minnow roadmap/u);

    const listResult = JSON.parse(await toolMinnowDocsList({ prefix: 'documentation/guides/' }));
    assert.ok(listResult.entries.length > 0);
    assert.ok(listResult.entries.every((entry) => entry.path.startsWith('documentation/guides/')));
  });

  test('returns explicit errors for missing arguments', async () => {
    assert.equal(await toolMinnowDocsSearch({}), 'Error: query is required.');
    assert.equal(await toolMinnowDocsRead({}), 'Error: path is required.');
  });
});

describe('GitHub Wiki staging contract', () => {
  test('publishing script and workflow are present', async () => {
    const script = await fs.readFile(
      path.join(repositoryRoot, 'scripts/publish-github-wiki.mjs'),
      'utf8',
    );
    const workflow = await fs.readFile(
      path.join(repositoryRoot, '.github/workflows/wiki-sync.yml'),
      'utf8',
    );
    assert.match(script, /_Sidebar\.md/u);
    assert.match(workflow, /WIKI_SYNC_TOKEN/u);
  });
});
