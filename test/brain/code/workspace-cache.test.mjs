/**
 * MIN-B11 — per-workspace SQLite handle cache and startup warming.
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
import {
  closeCodeDbForTests,
  getCodeDb,
  MAX_OPEN_CODE_DBS,
  openCodeDbCountForTests,
} from '../../../server/brain/code/schema.js';
import { reindexCode } from '../../../server/brain/code/indexer.js';
import { findSymbol } from '../../../server/brain/code/query.js';
import {
  warmCodeIndexForPath,
  warmCodeIndexForWorkspace,
  warmRecentWorkspaceCodeIndexes,
} from '../../../server/brain/code/workspace-cache.js';
import { brainWorkspaceKeyFromPath } from '../../../server/brain/paths.js';
import { setWorkspaceRoot } from '../../../server/workspace/root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const SAMPLE_TEXT = [
  'export const MY_EXPORT = 42;',
  'function callee() { return 1; }',
  'function caller() {',
  '  callee();',
  '}',
].join('\n');

async function seedFakeLspHome(homeDir) {
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
}

describe('MIN-B11 workspace code-index cache', () => {
  let homeDir;
  let workspaceA;
  let workspaceB;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-b11-cache-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
    shutdownAllLsp();
    await seedFakeLspHome(homeDir);

    workspaceA = path.join(homeDir, 'project-a');
    workspaceB = path.join(homeDir, 'project-b');
    await fs.mkdir(workspaceA, { recursive: true });
    await fs.mkdir(workspaceB, { recursive: true });

    await fs.writeFile(
      path.join(homeDir, 'config.json'),
      JSON.stringify(
        {
          workspace: {
            path: workspaceA,
            recentPaths: [workspaceA, workspaceB],
          },
          brain: { code: { enabled: true, reindexCadence: 'on-demand' } },
        },
        null,
        2,
      ),
      'utf8',
    );
  });

  after(async () => {
    shutdownAllLsp();
    closeCodeDbForTests();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('warmCodeIndexForPath opens persisted index without reindexing', async () => {
    await setWorkspaceRoot(workspaceA);
    const samplePath = 'cache-a.fake';
    await fs.writeFile(path.join(workspaceA, samplePath), SAMPLE_TEXT, 'utf8');
    await reindexCode({ files: [samplePath] });

    closeCodeDbForTests();

    warmCodeIndexForPath(workspaceA);
    const repo = brainWorkspaceKeyFromPath(workspaceA);
    const db = getCodeDb(repo);
    const count = db.prepare('SELECT COUNT(*) AS n FROM symbols WHERE repo = ?').get(repo).n;
    assert.ok(count > 0);

    const { matches } = await findSymbol('callee', 5);
    assert.ok(matches.some((m) => m.name === 'callee'));
  });

  it('switching workspaces reuses separate cached databases', async () => {
    const sampleA = 'switch-a.fake';
    const sampleB = 'switch-b.fake';
    await fs.writeFile(path.join(workspaceA, sampleA), SAMPLE_TEXT, 'utf8');
    await fs.writeFile(
      path.join(workspaceB, sampleB),
      [
        'export const OTHER_EXPORT = 1;',
        'function callee() { return OTHER_EXPORT; }',
      ].join('\n'),
      'utf8',
    );

    await setWorkspaceRoot(workspaceA);
    await reindexCode({ files: [sampleA] });
    const repoA = brainWorkspaceKeyFromPath(workspaceA);

    await setWorkspaceRoot(workspaceB);
    await reindexCode({ files: [sampleB] });
    const repoB = brainWorkspaceKeyFromPath(workspaceB);

    await setWorkspaceRoot(workspaceA);
    warmCodeIndexForWorkspace(repoA);
    const dbA = getCodeDb(repoA);
    const symbolA = dbA
      .prepare('SELECT name FROM symbols WHERE repo = ? AND name = ?')
      .get(repoA, 'callee');
    assert.ok(symbolA);

    warmCodeIndexForWorkspace(repoB);
    const dbB = getCodeDb(repoB);
    const symbolB = dbB
      .prepare('SELECT name FROM symbols WHERE repo = ? AND name = ?')
      .get(repoB, 'callee');
    assert.ok(symbolB);
    assert.notEqual(repoA, repoB);
  });

  it('LRU evicts oldest open handles beyond MAX_OPEN_CODE_DBS', () => {
    closeCodeDbForTests();
    for (let i = 0; i < MAX_OPEN_CODE_DBS + 2; i += 1) {
      getCodeDb(`lru-workspace-${i}`);
    }
    assert.ok(openCodeDbCountForTests() <= MAX_OPEN_CODE_DBS);
  });

  it('warmRecentWorkspaceCodeIndexes opens active and MRU workspace handles', async () => {
    closeCodeDbForTests();
    await setWorkspaceRoot(workspaceA);
    const result = await warmRecentWorkspaceCodeIndexes();
    assert.ok(result.warmed.length >= 1);
    assert.ok(openCodeDbCountForTests() >= 1);
  });
});
