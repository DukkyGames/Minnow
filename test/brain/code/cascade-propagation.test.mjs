/**
 * MIN-B10 — code change propagates stale flag to anchored wiki pages (MIN-B9 bridge).
 *
 * Uses a throwaway workspace so the suite never mutates `test/fixtures/sample.fake`
 * in the Minnow tree (that fixture is shared with LSP tests).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../../server/config/home.js';
import { invalidateLspConfigCache } from '../../../server/lsp/config-loader.js';
import { shutdownAllLsp } from '../../../server/lsp/manager.js';
import { propagateCodeChanges } from '../../../server/brain/code/cascade.js';
import { reindexCode } from '../../../server/brain/code/indexer.js';
import { closeCodeDbForTests, getCodeDb } from '../../../server/brain/code/schema.js';
import { brainWorkspaceKeyFromPath } from '../../../server/brain/paths.js';
import { createPage, ensureBrainStore, readPage } from '../../../server/brain/store.js';
import { setWorkspaceRoot } from '../../../server/workspace/root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SAMPLE_FILE = 'sample.fake';
const PAGE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SAMPLE_TEXT = [
  'export const MY_EXPORT = 42;',
  'function callee() { return 1; }',
  'function caller() {',
  '  callee();',
  '}',
].join('\n');

async function seedFakeLspHome(homeDir) {
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  invalidateLspConfigCache();
  shutdownAllLsp();
  await fs.mkdir(homeDir, { recursive: true });
  await fs.writeFile(
    path.join(homeDir, 'lsp.json'),
    `${JSON.stringify(
      {
        enabled: true,
        servers: {
          fake: {
            command: 'node',
            args: [path.join(PROJECT_ROOT, 'test/fixtures/fake-lsp.mjs')],
            filetypes: ['fake'],
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(homeDir, 'config.json'),
    JSON.stringify({ brain: { code: { enabled: true } } }, null, 2),
    'utf8',
  );
}

describe('MIN-B10 cascade propagation', () => {
  /** @type {string} */
  let homeDir = '';
  /** @type {string} */
  let workDir = '';

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-b10-prop-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-b10-ws-'));
    await seedFakeLspHome(homeDir);
    await ensureBrainStore();
    await setWorkspaceRoot(workDir);
    await fs.writeFile(path.join(workDir, SAMPLE_FILE), SAMPLE_TEXT, 'utf8');
    await reindexCode({ files: [SAMPLE_FILE] });
  });

  after(async () => {
    shutdownAllLsp();
    closeCodeDbForTests();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    if (homeDir) await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    if (workDir) await fs.rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('reindex through cascade marks anchored page stale when symbol span changes', async () => {
    const repo = brainWorkspaceKeyFromPath(workDir);
    const symbolId = `${repo}:caller`;
    const db = getCodeDb(repo);

    await createPage({
      relPath: 'facts/cascade-caller.md',
      id: PAGE_ID,
      title: 'Cascade caller note',
      anchors: [symbolId],
      body: 'Anchored before cascade reindex.',
      skipVectorSync: true,
    });

    const anchorBefore = db
      .prepare('SELECT symbol_hash_at_synth FROM anchors WHERE page_id = ? AND symbol_id = ?')
      .get(PAGE_ID, symbolId);
    assert.ok(anchorBefore?.symbol_hash_at_synth);

    const abs = path.join(workDir, SAMPLE_FILE);
    await fs.writeFile(
      abs,
      [
        'export const MY_EXPORT = 42;',
        'function callee() { return 1; }',
        'function caller() { // drift marker',
        '  callee();',
        '}',
      ].join('\n'),
      'utf8',
    );

    const result = await propagateCodeChanges({
      files: [SAMPLE_FILE],
      focusFiles: [SAMPLE_FILE],
      trigger: 'manual',
    });

    assert.ok(result.anchorDrift?.length >= 1);
    assert.ok(result.anchorDrift.some((row) => row.pageId === PAGE_ID));

    const page = await readPage('facts/cascade-caller.md');
    assert.equal(page.meta.status, 'stale');

    await fs.writeFile(abs, SAMPLE_TEXT, 'utf8');
    await propagateCodeChanges({ files: [SAMPLE_FILE], trigger: 'manual' });
  });
});
