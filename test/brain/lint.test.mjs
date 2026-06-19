/**
 * Brain lint report structure (no LLM).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache, ensureMinnowLayout } from '../../server/config/home.js';
import { lintBrainWiki, findMissingLinkTargets } from '../../server/brain/lint.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { createPage, ensureBrainStore } from '../../server/brain/store.js';

const PAGE_A = '11111111-1111-1111-1111-111111111111';
const PAGE_B = '22222222-2222-2222-2222-222222222222';

let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-lint-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await ensureMinnowLayout();
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
