/**
 * Bundled typescript-language-server starts and accepts LSP initialize.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { invalidateLspConfigCache } from '../../server/lsp/config-loader.js';
import { getLspCompletions, shutdownAllLsp } from '../../server/lsp/manager.js';
import { setAppRoot, setWorkspaceRoot } from '../../server/workspace/root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('typescript LSP integration', () => {
  let homeDir;
  let tempWorkspace;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    setAppRoot(PROJECT_ROOT);
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-ts-lsp-'));
    await fs.writeFile(
      path.join(tempWorkspace, 'sample.ts'),
      'const greeting = "hi"\nconsole.\n',
      'utf8',
    );

    homeDir = path.join(__dirname, '../fixtures/lsp-typescript-home');
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
    shutdownAllLsp();
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.mkdir(homeDir, { recursive: true });
    await fs.writeFile(
      path.join(homeDir, 'lsp.json'),
      `${JSON.stringify({ enabled: true, lsp: { typescript: { disabled: false } } }, null, 2)}\n`,
      'utf8',
    );
    await setWorkspaceRoot(tempWorkspace);
  });

  after(async () => {
    shutdownAllLsp();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
    await setWorkspaceRoot(PROJECT_ROOT);
    if (tempWorkspace) {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    }
  });

  test('completion works without workspace-local typescript', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    const { items, error } = await getLspCompletions('sample.ts', 1, 8);
    assert.ifError(error ? new Error(error) : null);
    assert.ok(items.length > 0, 'expected completion items from bundled typescript');
  });
});
