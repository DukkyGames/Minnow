/**
 * Brain lint report structure (no LLM).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache, ensureMinnowLayout } from '../../server/config/home.js';
import { lintBrainWiki, findMissingLinkTargets, collectWikiDiagnostics } from '../../server/brain/lint.js';
import { detectAnchorDrift } from '../../server/brain/code/anchors.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { createPage, ensureBrainStore, loadCatalog } from '../../server/brain/store.js';

async function loadCatalogSnapshot() {
  const catalog = await loadCatalog();
  return catalog.pages.map((p) => ({ path: p.path, status: p.status }));
}

const PAGE_A = '11111111-1111-1111-1111-111111111111';
const PAGE_B = '22222222-2222-2222-2222-222222222222';

let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-lint-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await ensureMinnowLayout();
  // lint apply paths call updatePage, which schedules vector sync — disable embeddings
  // so teardown does not race fire-and-forget embedder I/O on Windows CI.
  const configPath = path.join(homeDir, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.memory.embeddings.enabled = false;
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await ensureBrainStore();
});

after(async () => {
  closeCodeDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('brain lint', () => {
  test('findMissingLinkTargets flags unresolved wikilinks', () => {
    const missing = findMissingLinkTargets([
      { path: 'facts/a.md', links: ['missing-topic'] },
      { path: 'facts/b.md', links: ['facts/a'] },
    ]);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].from, 'facts/a.md');
    assert.equal(missing[0].target, 'missing-topic');
  });

  test('findMissingLinkTargets resolves slug paths like resolvePageLookup', () => {
    const pages = [
      { path: 'facts/target.md', links: [] },
      { path: 'facts/source.md', links: ['facts/target'] },
      { path: 'notes/only-basename.md', links: ['only-basename'] },
    ];
    const missing = findMissingLinkTargets(pages);
    assert.equal(missing.length, 0);
  });

  test('collectWikiDiagnostics is read-only and documents orphans', async () => {
    const before = await loadCatalogSnapshot();
    const report = await collectWikiDiagnostics();
    const after = await loadCatalogSnapshot();

    assert.ok(report.generatedAt);
    assert.match(report.definitions.orphans, /inbound wikilinks/i);
    assert.match(report.definitions.orphans, /similarTo/i);
    assert.ok(Array.isArray(report.orphans));
    assert.ok(Array.isArray(report.stale));
    assert.ok(Array.isArray(report.missingLinks));
    assert.ok(Array.isArray(report.anchorDrift));
    assert.equal(report.weakSimilarLinks.dryRun, true);
    assert.ok(Array.isArray(report.weakSimilarLinks.removals));
    assert.equal('contradictions' in report, false);
    assert.deepEqual(before, after);
  });

  test('detectAnchorDrift and collectWikiDiagnostics do not mark pages stale', async () => {
    const drift = await detectAnchorDrift();
    assert.ok(Array.isArray(drift));
    const report = await collectWikiDiagnostics();
    for (const entry of report.anchorDrift) {
      assert.ok(entry.pageId);
      assert.ok(Array.isArray(entry.symbolIds));
      assert.match(entry.summary, /Anchored symbol/);
    }
  });

  test('lintBrainWiki returns structured report without LLM', async () => {
    await createPage({
      relPath: 'facts/orphan-note.md',
      id: PAGE_A,
      title: 'Orphan',
      body: 'No inbound links.',
      source: 'user',
      skipVectorSync: true,
    });
    await createPage({
      relPath: 'facts/linked-note.md',
      id: PAGE_B,
      title: 'Linked',
      body: 'See [[facts/orphan-note]].',
      source: 'user',
      skipVectorSync: true,
    });

    const report = await lintBrainWiki({ includeLlm: false });
    assert.ok(report.generatedAt);
    assert.equal(typeof report.pageCount, 'number');
    assert.ok(Array.isArray(report.orphans));
    assert.ok(Array.isArray(report.stale));
    assert.ok(Array.isArray(report.missingLinks));
    assert.ok(Array.isArray(report.contradictions));
    assert.ok(['ok', 'active'].includes(report.extensions.anchorDrift));
  });

  test('lintBrainWiki apply=true marks orphan stale on first pass', async () => {
    await createPage({
      relPath: 'facts/apply-orphan.md',
      id: '33333333-3333-3333-3333-333333333333',
      title: 'Apply Orphan',
      body: 'No one links here.',
      source: 'user',
      skipVectorSync: true,
    });

    const report = await lintBrainWiki({ includeLlm: false, apply: true });
    assert.ok(Array.isArray(report.applied), 'applied array present');
    const entry = report.applied.find((a) => a.path.includes('apply-orphan'));
    assert.ok(entry, 'apply-orphan present in applied');
    assert.equal(entry.action, 'marked-stale');
  });

  test('lintBrainWiki apply=true deletes stale orphan on second pass', async () => {
    const report = await lintBrainWiki({ includeLlm: false, apply: true });
    assert.ok(Array.isArray(report.applied), 'applied array present');
    const entry = report.applied.find((a) => a.path.includes('apply-orphan'));
    assert.ok(entry, 'apply-orphan deleted on second pass');
    assert.equal(entry.action, 'deleted');
  });
});
