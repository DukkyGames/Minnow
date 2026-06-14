/**
 * Cached model scan tests — fixture directories.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { listCachedModels } from '../../server/models/cached.js';

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
