/**
 * Cached model scan tests — fixture directories.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { listCachedModels, ensureHfHubCacheDir, resolveHfHubCacheDir } from '../../server/models/cached.js';

describe('cached model scan', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string} */
  let prevHome;

  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-cached-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();

    const repoDir = path.join(homeDir, 'models', 'artifacts', 'org--demo');
    await fsp.mkdir(repoDir, { recursive: true });
    await fsp.writeFile(path.join(repoDir, 'model-Q4_K_M.gguf'), Buffer.alloc(1024));
  });

  after(async () => {
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('finds Minnow artifact downloads', async () => {
    const { models } = await listCachedModels();
    const hit = models.find((m) => m.repo_id === 'org/demo');
    assert.ok(hit, 'expected org/demo artifact');
    assert.equal(hit.is_gguf, true);
    assert.ok(hit.gguf_files?.some((g) => g.name === 'model-Q4_K_M.gguf'));
  });
});

describe('HF hub cache dir for mlx_lm.server', () => {
  /** @type {string | undefined} */
  let prevHub;
  /** @type {string | undefined} */
  let prevHfHub;
  /** @type {string} */
  let tmpHub;

  before(async () => {
    prevHub = process.env.HUGGINGFACE_HUB_CACHE;
    prevHfHub = process.env.HF_HUB_CACHE;
    tmpHub = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-hf-hub-'));
    delete process.env.HUGGINGFACE_HUB_CACHE;
    delete process.env.HF_HUB_CACHE;
  });

  after(async () => {
    if (prevHub === undefined) delete process.env.HUGGINGFACE_HUB_CACHE;
    else process.env.HUGGINGFACE_HUB_CACHE = prevHub;
    if (prevHfHub === undefined) delete process.env.HF_HUB_CACHE;
    else process.env.HF_HUB_CACHE = prevHfHub;
    await fsp.rm(tmpHub, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('ensureHfHubCacheDir creates the default layout when unset', async () => {
    const parent = path.join(tmpHub, 'default-cache-parent');
    const expected = path.join(parent, '.cache', 'huggingface', 'hub');
    const prevHome = process.env.HOME;
    process.env.HOME = parent;

    try {
      const resolved = resolveHfHubCacheDir();
      assert.equal(resolved, expected);
      const ensured = await ensureHfHubCacheDir(resolved);
      assert.equal(ensured, expected);
      const stat = await fsp.stat(expected);
      assert.ok(stat.isDirectory());
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });

  test('resolveHfHubCacheDir honors HF_HUB_CACHE', () => {
    process.env.HF_HUB_CACHE = tmpHub;
    assert.equal(resolveHfHubCacheDir(), tmpHub);
    delete process.env.HF_HUB_CACHE;
  });
});
