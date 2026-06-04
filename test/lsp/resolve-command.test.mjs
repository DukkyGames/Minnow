/**
 * LSP command resolution — managed dir and $minnow: tokens.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { setAppRoot } from '../../server/workspace/root.js';
import {
  getManagedLspServersDir,
  resolveLspSpawnArgv,
} from '../../server/lsp/resolve-command.js';

const APP_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('resolveLspSpawnArgv managed dir', () => {
  /** @type {string} */
  let tempHome;

  before(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-lsp-resolve-'));
    process.env.MINNOW_HOME = tempHome;
    resetMinnowHomeCache();
    setAppRoot(APP_ROOT);

    const managed = path.join(tempHome, 'lsp-servers');
    await fsp.mkdir(path.join(managed, 'node_modules', 'pyright'), { recursive: true });
    await fsp.writeFile(
      path.join(managed, 'package.json'),
      JSON.stringify({ name: 'minnow-lsp-managed', private: true }),
      'utf8',
    );
    const appPyright = path.join(APP_ROOT, 'node_modules', 'pyright', 'langserver.index.js');
    if (fs.existsSync(appPyright)) {
      await fsp.cp(appPyright, path.join(managed, 'node_modules', 'pyright', 'langserver.index.js'));
      await fsp.writeFile(
        path.join(managed, 'node_modules', 'pyright', 'package.json'),
        JSON.stringify({ name: 'pyright', version: '0.0.0-test' }),
        'utf8',
      );
    }
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('exposes managed lsp-servers directory under MINNOW_HOME', () => {
    assert.equal(getManagedLspServersDir(), path.join(tempHome, 'lsp-servers'));
  });

  it('resolves $minnow:pyright-langserver to node + cli when pyright is available', () => {
    const appPyright = path.join(APP_ROOT, 'node_modules', 'pyright', 'langserver.index.js');
    if (!fs.existsSync(appPyright)) {
      console.log('skip: pyright not installed in app node_modules');
      return;
    }
    const { argv, displayBin } = resolveLspSpawnArgv(['$minnow:pyright-langserver']);
    assert.equal(argv[0], 'node');
    assert.match(argv[1], /langserver\.index\.js$/);
    assert.ok(argv.includes('--stdio'));
    assert.equal(displayBin, 'pyright-langserver');
  });

  it('resolves typescript $minnow token when app bundle exists', () => {
    const tlsCli = path.join(
      APP_ROOT,
      'node_modules',
      'typescript-language-server',
      'lib',
      'cli.mjs',
    );
    if (!fs.existsSync(tlsCli)) {
      console.log('skip: typescript-language-server not installed');
      return;
    }
    const { argv, displayBin } = resolveLspSpawnArgv([
      '$minnow:typescript-language-server',
    ]);
    assert.equal(argv[0], 'node');
    assert.match(argv[1], /cli\.mjs$/);
    assert.equal(displayBin, 'typescript-language-server');
  });
});
