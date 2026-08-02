/**
 * Integration: fake LSP returns static diagnostics for test/fixtures/sample.fake
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { invalidateLspConfigCache } from '../../server/lsp/config-loader.js';
import { getLspDiagnostics, getLspSignatureHelp, shutdownAllLsp } from '../../server/lsp/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('fake LSP integration', () => {
  let homeDir;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    homeDir = path.join(__dirname, '../fixtures/lsp-home');
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
    shutdownAllLsp();
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.mkdir(homeDir, { recursive: true });
    const lspJson = {
      enabled: true,
      lsp: {
        fake: {
          disabled: false,
          command: ['node', 'test/fixtures/fake-lsp.mjs'],
          extensions: ['.fake'],
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

  test('getLspDiagnostics includes static fake error', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    const result = await getLspDiagnostics('test/fixtures/sample.fake');
    assert.match(result, /';' expected/);
    assert.match(result, /fake/);
  });

  test('getLspHover returns fixture markdown', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    const { getLspHover } = await import('../../server/lsp/manager.js');
    const { hover } = await getLspHover('test/fixtures/sample.fake', 0, 0);
    const text =
      hover?.contents?.value ?? (typeof hover?.contents === 'string' ? hover.contents : '');
    assert.match(String(text), /Fake hover/i);
  });

  test('getLspSignatureHelp returns fixture signature', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') {
      return;
    }
    const { signatureHelp } = await getLspSignatureHelp('test/fixtures/sample.fake', 0, 0);
    assert.ok(signatureHelp?.signatures?.length);
    assert.match(String(signatureHelp.signatures[0].label ?? ''), /fakeFn/i);
  });
});
