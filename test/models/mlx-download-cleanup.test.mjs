/**
 * MLX download cleanup — the regression guard for a directory artifact.
 *
 * `fsp.rm(path, { force: true })` silently no-ops on a directory. Every failed,
 * cancelled, or interrupted MLX job used to leave its half-downloaded repo on
 * disk, where the library scanner then listed it as servable and it failed at
 * load. The removal has to be recursive for MLX, and must still take the
 * `.partial` sibling for GGUF.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { listDownloads, resetDownloadsForTests } from '../../server/models/download.js';
import { getDownloadsIndexPath } from '../../server/models/paths.js';

/** @type {string} */
let homeDir;
/** @type {string | undefined} */
let prevHome;

/** Persist jobs as if a previous tool-server process had left them running. */
async function seedInterruptedJobs(jobs) {
  await fsp.mkdir(path.dirname(getDownloadsIndexPath()), { recursive: true });
  await fsp.writeFile(
    getDownloadsIndexPath(),
    JSON.stringify({ version: 1, jobs }, null, 2),
    'utf8',
  );
  await resetDownloadsForTests();
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

describe('MLX download cleanup', () => {
  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-mlx-cleanup-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  beforeEach(async () => {
    await resetDownloadsForTests();
  });

  after(async () => {
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await resetDownloadsForTests();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('removes the whole artifact directory, not just a file at that path', async () => {
    const destPath = path.join(homeDir, 'models', 'artifacts', 'mlx-community--Qwen3-8B-4bit');
    await fsp.mkdir(path.join(destPath, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(destPath, 'config.json'), '{"quantization":{"bits":4}}');
    await fsp.writeFile(path.join(destPath, 'model.safetensors.partial'), Buffer.alloc(64));
    await fsp.writeFile(path.join(destPath, 'nested', 'extra.bin'), Buffer.alloc(64));

    await seedInterruptedJobs([
      {
        id: '22222222-2222-4222-8222-222222222222',
        repoId: 'mlx-community/Qwen3-8B-4bit',
        filename: '',
        repoFilePath: '',
        quant: 'mlx-4bit',
        format: 'mlx',
        status: 'running',
        bytesReceived: 2048,
        totalBytes: 4_600_000_000,
        destPath,
        createdAt: Date.now(),
      },
    ]);

    const jobs = await listDownloads();
    assert.equal(jobs[0].status, 'failed');
    assert.equal(
      await exists(destPath),
      false,
      'a partially downloaded MLX repo must not survive to be scanned as servable',
    );
  });

  test('still cleans up a GGUF file and its .partial sibling', async () => {
    const destDir = path.join(homeDir, 'models', 'artifacts', 'org--gguf-demo');
    const destPath = path.join(destDir, 'model-Q4_K_M.gguf');
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(destPath, Buffer.alloc(64));
    await fsp.writeFile(`${destPath}.partial`, Buffer.alloc(64));

    await seedInterruptedJobs([
      {
        id: '33333333-3333-4333-8333-333333333333',
        repoId: 'org/gguf-demo',
        filename: 'model-Q4_K_M.gguf',
        repoFilePath: 'model-Q4_K_M.gguf',
        quant: 'Q4_K_M',
        format: 'gguf',
        status: 'queued',
        bytesReceived: 64,
        totalBytes: 4096,
        destPath,
        createdAt: Date.now(),
      },
    ]);

    await listDownloads();
    assert.equal(await exists(destPath), false);
    assert.equal(await exists(`${destPath}.partial`), false);
    // Only the file goes; the repo folder is shared with other quants.
    assert.equal(await exists(destDir), true);
  });

  test('treats a job persisted before MLX support as GGUF', async () => {
    const destDir = path.join(homeDir, 'models', 'artifacts', 'org--legacy');
    const destPath = path.join(destDir, 'legacy-Q4_K_M.gguf');
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(destPath, Buffer.alloc(64));

    await seedInterruptedJobs([
      {
        id: '44444444-4444-4444-8444-444444444444',
        repoId: 'org/legacy',
        filename: 'legacy-Q4_K_M.gguf',
        repoFilePath: 'legacy-Q4_K_M.gguf',
        quant: 'Q4_K_M',
        // No `format` field at all — this is what downloads.json holds today.
        status: 'running',
        bytesReceived: 64,
        totalBytes: 4096,
        destPath,
        createdAt: Date.now(),
      },
    ]);

    const jobs = await listDownloads();
    assert.equal(jobs[0].format, 'gguf', 'missing format must default rather than break');
    assert.equal(await exists(destPath), false);
  });
});
