/**
 * Bundled LSP command resolution (typescript-language-server from Minnow node_modules).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveLspSpawnArgv } from '../../server/lsp/resolve-command.js';
import { setAppRoot } from '../../server/workspace/root.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('resolveLspSpawnArgv', () => {
  test('expands bundled typescript-language-server', () => {
    setAppRoot(PROJECT_ROOT);
    const { argv, displayBin } = resolveLspSpawnArgv(['$minnow:typescript-language-server']);
    assert.equal(displayBin, 'typescript-language-server');
    assert.equal(argv[0], 'node');
    assert.match(argv[1], /typescript-language-server[\\/]lib[\\/]cli\.mjs$/);
    assert.ok(argv.includes('--stdio'));
    assert.ok(!argv.includes('--tsserver-path'));
    assert.ok(fs.existsSync(argv[1]));
  });

  test('legacy global-style command still resolves to bundled binary', () => {
    setAppRoot(PROJECT_ROOT);
    const { argv } = resolveLspSpawnArgv(['typescript-language-server', '--stdio']);
    assert.equal(argv[0], 'node');
    assert.ok(!argv.includes('--tsserver-path'));
  });
});
