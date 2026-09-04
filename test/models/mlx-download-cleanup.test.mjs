/**
 * MLX download cleanup — the regression guard for a directory artifact.
 *
 * `fsp.rm(path, { force: true })` silently no-ops on a directory. Cancelled
 * MLX jobs must recursively remove the half-downloaded repo so the library
 * scanner does not list it as servable. Interrupted / failed jobs keep dest
 * and `.partial` so Range can resume. GGUF cancel still drops the dest file
 * and its `.partial` sibling, not the shared repo folder.
 *
 * `cleanupJobArtifacts` runs on the cancelled path only.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  cancelDownload,
  listDownloads,
  resetDownloadsForTests,
} from '../../server/models/download.js';
import { getDownloadsIndexPath } from '../../server/models/paths.js';

const ORIGINAL_FETCH = globalThis.fetch;

/** @type {string} */
let homeDir;
/** @type {string | undefined} */
let prevHome;

/**
 * Persist jobs as if a previous tool-server process had left them.
 * Must run AFTER `resetDownloadsForTests()` — reset now writes an empty index.
 * @param {object[]} jobs
 */
async function seedJobs(jobs) {
  await fsp.mkdir(path.dirname(getDownloadsIndexPath()), { recursive: true });
  await fsp.writeFile(
    getDownloadsIndexPath(),
    `${JSON.stringify({ version: 1, jobs }, null, 2)}\n`,
    'utf8',
  );
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

// Shared MINNOW_HOME + process-global jobsCache; do not overlap seed/reset.
describe('MLX download cleanup', { concurrency: false }, () => {
  before(async () => {
    prevHome = process.env.MINNOW_HOME;
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-mlx-cleanup-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  beforeEach(async () => {
    await resetDownloadsForTests();
    // Interrupt tests call listDownloads(), which requeues and pumps. Fail
    // fetch immediately so we never hit the Hub; artifacts must still remain.
    globalThis.fetch = async () => {
      throw new Error('mlx-download-cleanup tests must not hit the network');
    };
  });

  afterEach(async () => {
    globalThis.fetch = ORIGINAL_FETCH;
    await resetDownloadsForTests();
  });

  after(async () => {
    if (prevHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = prevHome;
    resetMinnowHomeCache();
    await resetDownloadsForTests();
    await fsp.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('interrupted restart keeps the MLX artifact directory', async () => {
    const destPath = path.join(homeDir, 'models', 'artifacts', 'mlx-community--Qwen3-8B-4bit');
    await fsp.mkdir(path.join(destPath, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(destPath, 'config.json'), '{"quantization":{"bits":4}}');
    await fsp.writeFile(path.join(destPath, 'model.safetensors.partial'), Buffer.alloc(64));
    await fsp.writeFile(path.join(destPath, 'nested', 'extra.bin'), Buffer.alloc(64));

    await seedJobs([
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
    assert.ok(jobs[0], 'seeded job must load after reset, not be wiped by it');
    assert.notEqual(jobs[0].status, 'failed');
    assert.equal(jobs[0].interrupted, true);
    assert.equal(await exists(destPath), true, 'interrupt must keep the MLX repo directory');
    assert.equal(await exists(path.join(destPath, 'nested', 'extra.bin')), true);
  });

  test('interrupted restart keeps a GGUF dest and its .partial sibling', async () => {
    const destDir = path.join(homeDir, 'models', 'artifacts', 'org--gguf-demo');
    const destPath = path.join(destDir, 'model-Q4_K_M.gguf');
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(destPath, Buffer.alloc(64));
    await fsp.writeFile(`${destPath}.partial`, Buffer.alloc(64));

    await seedJobs([
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

    const jobs = await listDownloads();
    assert.ok(jobs[0], 'seeded job must load after reset, not be wiped by it');
    assert.notEqual(jobs[0].status, 'failed');
    assert.equal(jobs[0].interrupted, true);
    assert.equal(await exists(destPath), true);
    assert.equal(await exists(`${destPath}.partial`), true);
    assert.equal(await exists(destDir), true);
  });

  test('interrupted restart treats a job persisted before MLX support as GGUF', async () => {
    const destDir = path.join(homeDir, 'models', 'artifacts', 'org--legacy');
    const destPath = path.join(destDir, 'legacy-Q4_K_M.gguf');
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(destPath, Buffer.alloc(64));

    await seedJobs([
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
    assert.ok(jobs[0], 'seeded job must load after reset, not be wiped by it');
    assert.equal(jobs[0].format, 'gguf', 'missing format must default rather than break');
    assert.notEqual(jobs[0].status, 'failed');
    assert.equal(jobs[0].interrupted, true);
    assert.equal(await exists(destPath), true, 'legacy GGUF dest must survive interrupt');
  });

  test('cancel recursively removes the MLX artifact directory', async () => {
    const destPath = path.join(homeDir, 'models', 'artifacts', 'mlx-community--Qwen3-8B-cancel');
    await fsp.mkdir(path.join(destPath, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(destPath, 'config.json'), '{"quantization":{"bits":4}}');
    await fsp.writeFile(path.join(destPath, 'model.safetensors.partial'), Buffer.alloc(64));
    await fsp.writeFile(path.join(destPath, 'nested', 'extra.bin'), Buffer.alloc(64));

    // Seed as interrupted so loadJobs does not requeue/pump — cancel then hits
    // cleanupJobArtifacts synchronously (no in-flight AbortController).
    await seedJobs([
      {
        id: '55555555-5555-4555-8555-555555555555',
        repoId: 'mlx-community/Qwen3-8B-cancel',
        filename: '',
        repoFilePath: '',
        quant: 'mlx-4bit',
        format: 'mlx',
        status: 'interrupted',
        bytesReceived: 2048,
        totalBytes: 4_600_000_000,
        destPath,
        createdAt: Date.now(),
      },
    ]);

    const cancelled = await cancelDownload('55555555-5555-4555-8555-555555555555');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(
      await exists(destPath),
      false,
      'a cancelled MLX repo must be removed recursively, not left for the scanner',
    );
  });

  test('cancel still cleans up a GGUF file and its .partial sibling', async () => {
    const destDir = path.join(homeDir, 'models', 'artifacts', 'org--gguf-cancel');
    const destPath = path.join(destDir, 'model-Q4_K_M.gguf');
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(destPath, Buffer.alloc(64));
    await fsp.writeFile(`${destPath}.partial`, Buffer.alloc(64));

    await seedJobs([
      {
        id: '66666666-6666-4666-8666-666666666666',
        repoId: 'org/gguf-cancel',
        filename: 'model-Q4_K_M.gguf',
        repoFilePath: 'model-Q4_K_M.gguf',
        quant: 'Q4_K_M',
        format: 'gguf',
        status: 'interrupted',
        bytesReceived: 64,
        totalBytes: 4096,
        destPath,
        createdAt: Date.now(),
      },
    ]);

    const cancelled = await cancelDownload('66666666-6666-4666-8666-666666666666');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(await exists(destPath), false);
    assert.equal(await exists(`${destPath}.partial`), false);
    // Only the file goes; the repo folder is shared with other quants.
    assert.equal(await exists(destDir), true);
  });
});
