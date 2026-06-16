/**
 * Code index integration — LSP fake server, SQLite, queries (MIN-B7).
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
import { closeCodeDbForTests, getCodeDb } from '../../../server/brain/code/schema.js';
import { brainWorkspaceKeyFromPath } from '../../../server/brain/paths.js';
import { reindexCode } from '../../../server/brain/code/indexer.js';
import { findSymbol, readSymbol, whoCalls } from '../../../server/brain/code/query.js';
import { executeServerTool } from '../../../server/runtime/tools-middleware.js';
import { setWorkspaceRoot } from '../../../server/workspace/root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SAMPLE_PATH = 'test/fixtures/sample.fake';
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

describe('code index integration', () => {
  let homeDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-code-index-'));
    await seedFakeLspHome(homeDir);
    await setWorkspaceRoot(PROJECT_ROOT);
    const abs = path.join(PROJECT_ROOT, SAMPLE_PATH);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, SAMPLE_TEXT, 'utf8');
  });

  after(async () => {
    shutdownAllLsp();
    closeCodeDbForTests();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('reindex stores symbols with stable ids', async () => {
    const result = await reindexCode({ files: [SAMPLE_PATH] });
    assert.ok(result.indexedFiles >= 1);
    const { matches } = await findSymbol('callee', 5);
    const hit = matches.find((m) => m.name === 'callee');
    assert.ok(hit, 'expected callee in index');
    assert.equal(hit.id, 'minnow:MY_EXPORT.callee');
    assert.equal(hit.file, SAMPLE_PATH);
  });

  it('who_calls returns graph callers for callee', async () => {
    const { callers, symbol } = await whoCalls('callee');
    assert.ok(symbol);
    assert.ok(callers.length >= 1);
    assert.ok(callers.some((c) => c.name === 'caller'));
  });

  it('read_symbol returns live source lines', async () => {
    const { text, symbol } = await readSymbol('caller');
    assert.ok(symbol);
    assert.match(text, /caller/);
    assert.match(text, /callee\(\)/);
  });

  it('incremental reindex updates file hash after content change', async () => {
    const repo = brainWorkspaceKeyFromPath(PROJECT_ROOT);
    const db = getCodeDb(repo);
    const before = db
      .prepare('SELECT sha256 FROM file_hashes WHERE repo = ? AND file = ?')
      .get(repo, SAMPLE_PATH);

    const abs = path.join(PROJECT_ROOT, SAMPLE_PATH);
    const edited = `${SAMPLE_TEXT}\n// edited marker\n`;
    await fs.writeFile(abs, edited, 'utf8');

    await reindexCode({ files: [SAMPLE_PATH] });
    const after = db
      .prepare('SELECT sha256 FROM file_hashes WHERE repo = ? AND file = ?')
      .get(repo, SAMPLE_PATH);

    assert.notEqual(before?.sha256, after?.sha256);
    await fs.writeFile(abs, SAMPLE_TEXT, 'utf8');
  });

  it('find_symbol tool formats matches', async () => {
    await reindexCode({ files: [SAMPLE_PATH] });
    const out = await executeServerTool('find_symbol', { query: 'MY_EXPORT' });
    assert.match(out.result, /MY_EXPORT/);
    assert.match(out.result, /sample\.fake/);
  });
});
