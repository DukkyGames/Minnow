/**
 * Language bundle installer — catalog, status, mocked npm install.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { setAppRoot } from '../../server/workspace/root.js';
import {
  getBundleInstallStatus,
  installBundle,
  listBundlesWithStatus,
  resetBundlesCatalogCache,
  resetLspBundleSpawnOverride,
  setLspBundleSpawnForTests,
  uninstallBundle,
} from '../../server/lsp/bundle-installer.js';
import { getManagedLspMetaPath, getManagedLspNpmRoot } from '../../server/lsp/paths.js';

const APP_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('bundle-installer', () => {
  /** @type {string} */
  let tempHome;

  before(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-lsp-bundle-'));
    process.env.MINNOW_HOME = tempHome;
    resetMinnowHomeCache();
    resetBundlesCatalogCache();
    setAppRoot(APP_ROOT);
  });

  after(async () => {
    resetLspBundleSpawnOverride();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    resetBundlesCatalogCache();
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it('lists catalog categories from bundles.json', async () => {
    const { categories } = await listBundlesWithStatus();
    assert.ok(Array.isArray(categories));
    assert.ok(categories.some((c) => c.id === 'web'));
    const web = categories.find((c) => c.id === 'web');
    assert.ok(web?.bundles?.some((b) => b.id === 'vscode-html'));
  });

  it('reports binary bundle not installed before download', async () => {
    const status = await getBundleInstallStatus('rust-analyzer');
    assert.equal(status.found, true);
    assert.equal(status.installed, false);
  });

  it('installs npm bundle idempotently with mocked spawn', async () => {
    setLspBundleSpawnForTests((command, args) => {
      const child = {
        stderr: { on: () => {} },
        on(event, cb) {
          if (event === 'spawn') queueMicrotask(() => cb());
          if (event === 'close') {
            queueMicrotask(async () => {
              const prefixIdx = args.indexOf('--prefix');
              const prefix = prefixIdx >= 0 ? args[prefixIdx + 1] : '';
              const spec = args[args.length - 1] ?? '';
              const pkg =
                spec.split('@')[0] === 'graphql-language-service-cli'
                  ? 'graphql-language-service-cli'
                  : spec.split('@')[0];
              const pkgDir = path.join(prefix, 'node_modules', pkg);
              await fsp.mkdir(pkgDir, { recursive: true });
              await fsp.writeFile(
                path.join(pkgDir, 'package.json'),
                JSON.stringify({ name: pkg, version: '1.2.3-mock' }),
                'utf8',
              );
              cb(0);
            });
          }
        },
      };
      return child;
    });

    const first = await installBundle('graphql');
    assert.equal(first.ok, true);
    assert.equal(first.alreadyInstalled, false);

    const status = await getBundleInstallStatus('graphql');
    assert.equal(status.installed, true);
    assert.equal(status.version, '1.2.3-mock');

    const second = await installBundle('graphql');
    assert.equal(second.ok, true);
    assert.equal(second.alreadyInstalled, true);

    resetLspBundleSpawnOverride();
  });

  it('uninstall clears managed npm package and meta', async () => {
    const prefix = getManagedLspNpmRoot();
    const pkgDir = path.join(prefix, 'node_modules', 'graphql-language-service-cli');
    await fsp.mkdir(pkgDir, { recursive: true });
    await fsp.writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'graphql-language-service-cli', version: '9.9.9' }),
      'utf8',
    );
    await fsp.mkdir(path.dirname(getManagedLspMetaPath('graphql')), {
      recursive: true,
    });
    await fsp.writeFile(
      getManagedLspMetaPath('graphql'),
      JSON.stringify({ kind: 'npm', version: '9.9.9' }),
      'utf8',
    );

    setLspBundleSpawnForTests((_command, _args, opts) => {
      const child = {
        stderr: { on: () => {} },
        on(event, cb) {
          if (event === 'spawn') queueMicrotask(() => cb());
          if (event === 'close') {
            queueMicrotask(async () => {
              await fsp.rm(pkgDir, { recursive: true, force: true });
              cb(0);
            });
          }
        },
      };
      return child;
    });

    const removed = await uninstallBundle('graphql');
    assert.equal(removed.ok, true);
    const status = await getBundleInstallStatus('graphql');
    assert.equal(status.installed, false);
    resetLspBundleSpawnOverride();
  });
});
