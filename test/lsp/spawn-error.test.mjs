/**
 * Missing LSP binaries must not crash the dev server (ENOENT → caught spawn error).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { invalidateLspConfigCache } from '../../server/lsp/config-loader.js';
import { getLspDiagnostics, shutdownAllLsp } from '../../server/lsp/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('LSP spawn ENOENT', () => {
  let homeDir;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    homeDir = path.join(__dirname, '../fixtures/lsp-spawn-error-home');
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
    shutdownAllLsp();
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.mkdir(homeDir, { recursive: true });
    const lspJson = {
      enabled: true,
      lsp: {
        missing: {
          disabled: false,
          command: ['minnow-missing-lsp-binary-xyz'],
          extensions: ['.missinglsp'],
        },
      },
    };
    await fs.writeFile(
      path.join(homeDir, 'lsp.json'),
      `${JSON.stringify(lspJson, null, 2)}\n`,
      'utf8',
    );
  });

  after(() => {
    shutdownAllLsp();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
  });

  test('getLspDiagnostics returns install hint instead of throwing', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    const result = await getLspDiagnostics('sample.missinglsp');
    assert.match(result, /not installed or not on PATH/i);
    assert.match(result, /missing/);
  });
});
