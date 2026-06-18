/**
 * Archive extraction — Windows zip excludes (MIN-158).
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  buildTarExtractArgs,
  extractArchive,
  resetLspBundleSpawnOverride,
  setLspBundleSpawnForTests,
  WIN_ZIP_TAR_EXCLUDES,
} from '../../server/lsp/bundle-installer.js';
import { SEARXNG_ZIP_TAR_EXCLUDES } from '../../server/servers/searxng.js';

describe('extractArchive', () => {
  /** @type {string} */
  let tempDir;

  before(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-extract-archive-'));
  });

  after(async () => {
    resetLspBundleSpawnOverride();
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('buildTarExtractArgs appends --exclude globs', () => {
    const args = buildTarExtractArgs('/tmp/a.zip', '/tmp/out', ['*utils/templates*', '*:*']);
    assert.deepEqual(args, [
      '-xf',
      '/tmp/a.zip',
      '-C',
      '/tmp/out',
      '--exclude=*utils/templates*',
      '--exclude=*:*',
    ]);
  });

  it('extractArchive passes Windows colon excludes for zip archives', async () => {
    /** @type {string[] | null} */
    let capturedArgs = null;
    const archivePath = path.join(tempDir, 'sample.zip');
    const destDir = path.join(tempDir, 'dest-zip');
    await fsp.writeFile(archivePath, 'zip', 'utf8');

    setLspBundleSpawnForTests((command, args) => {
      capturedArgs = args;
      const child = {
        stderr: { on: () => {} },
        on(event, cb) {
          if (event === 'close') queueMicrotask(() => cb(0));
        },
      };
      return child;
    });

    await extractArchive(archivePath, destDir);
    assert.equal(capturedArgs?.[0], '-xf');
    if (process.platform === 'win32') {
      for (const pattern of WIN_ZIP_TAR_EXCLUDES) {
        assert.ok(capturedArgs?.includes(`--exclude=${pattern}`), `missing exclude ${pattern}`);
      }
    } else {
      assert.ok(!capturedArgs?.some((arg) => arg.startsWith('--exclude=')));
    }
    resetLspBundleSpawnOverride();
  });

  it('extractArchive forwards caller excludes for zip archives', async () => {
    /** @type {string[] | null} */
    let capturedArgs = null;
    const archivePath = path.join(tempDir, 'searxng.zip');
    const destDir = path.join(tempDir, 'dest-searxng');
    await fsp.writeFile(archivePath, 'zip', 'utf8');

    setLspBundleSpawnForTests((_command, args) => {
      capturedArgs = args;
      const child = {
        stderr: { on: () => {} },
        on(event, cb) {
          if (event === 'close') queueMicrotask(() => cb(0));
        },
      };
      return child;
    });

    await extractArchive(archivePath, destDir, { exclude: SEARXNG_ZIP_TAR_EXCLUDES });
    for (const pattern of SEARXNG_ZIP_TAR_EXCLUDES) {
      assert.ok(capturedArgs?.includes(`--exclude=${pattern}`));
    }
    resetLspBundleSpawnOverride();
  });
});
