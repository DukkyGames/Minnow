/**
 * LSP document sync — unsaved editor buffer must not be overwritten by disk reads.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { invalidateLspConfigCache } from '../../server/lsp/config-loader.js';
import {
  getLspDocumentSyncForTest,
  getLspStructuredDiagnostics,
  notifyLspDocument,
  shutdownAllLsp,
} from '../../server/lsp/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SAMPLE_PATH = 'test/fixtures/sample.fake';

async function seedFakeLspHome(homeDir) {
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  invalidateLspConfigCache();
  shutdownAllLsp();
  await fs.rm(homeDir, { recursive: true, force: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.writeFile(
    path.join(homeDir, 'lsp.json'),
    `${JSON.stringify(
      {
        enabled: true,
        lsp: {
          fake: {
            disabled: false,
            command: ['node', 'test/fixtures/fake-lsp.mjs'],
            extensions: ['.fake'],
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

describe('LSP document sync', () => {
  let homeDir;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;
    homeDir = path.join(__dirname, '../fixtures/lsp-doc-sync-home');
    await seedFakeLspHome(homeDir);
  });

  after(() => {
    shutdownAllLsp();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
  });

  test('structured diagnostics use editorText instead of disk', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const abs = path.join(PROJECT_ROOT, SAMPLE_PATH);
    await fs.writeFile(abs, 'DISK_ONLY_SHOULD_NOT_WIN\n', 'utf8');

    const editorText = 'let x = 1\n';
    await notifyLspDocument(SAMPLE_PATH, 'open', editorText);

    const { diagnostics } = await getLspStructuredDiagnostics(SAMPLE_PATH, editorText);
    assert.ok(Array.isArray(diagnostics));
    assert.equal(getLspDocumentSyncForTest(SAMPLE_PATH)?.text, editorText);

    await fs.writeFile(abs, 'DISK_AFTER_OPEN\n', 'utf8');
    const again = await getLspStructuredDiagnostics(SAMPLE_PATH, `${editorText}// edit`);
    assert.ok(Array.isArray(again.diagnostics));
    assert.equal(getLspDocumentSyncForTest(SAMPLE_PATH)?.text, `${editorText}// edit`);
  });

  test('duplicate didOpen is upgraded to didChange (version increments)', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    shutdownAllLsp();
    await notifyLspDocument(SAMPLE_PATH, 'open', 'first\n');
    assert.equal(getLspDocumentSyncForTest(SAMPLE_PATH)?.version, 1);

    await notifyLspDocument(SAMPLE_PATH, 'open', 'second\n');
    const sync = getLspDocumentSyncForTest(SAMPLE_PATH);
    assert.equal(sync?.version, 2);
    assert.equal(sync?.text, 'second\n');
  });
});
