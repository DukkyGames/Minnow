/**
 * Model download job tests — interrupted jobs, incomplete streams, happy path.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  listDownloads,
  resetDownloadsForTests,
  startDownload,
} from '../../server/models/download.js';
import { downloadHfFile } from '../../server/models/hf-client.js';
import { getDownloadsIndexPath } from '../../server/models/paths.js';

const ORIGINAL_FETCH = globalThis.fetch;

describe('model downloads', () => {
  /** @type {string} */
  let homeDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-model-dl-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await resetDownloadsForTests();
  });

  after(async () => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await resetDownloadsForTests();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('reconciles queued/running jobs after server restart', async () => {
    const destPath = path.join(homeDir, 'models', 'artifacts', 'org--demo', 'model-Q4_K_M.gguf');
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(`${destPath}.partial`, 'partial-bytes', 'utf8');

    const staleJob = {
      id: '11111111-1111-4111-8111-111111111111',
      repoId: 'org/demo',
      filename: 'model-Q4_K_M.gguf',
      repoFilePath: 'model-Q4_K_M.gguf',
      quant: 'Q4_K_M',
      status: 'running',
      bytesReceived: 1024,
      totalBytes: 4096,
      destPath,
      createdAt: Date.now(),
    };

    await fs.mkdir(path.dirname(getDownloadsIndexPath()), { recursive: true });
    await fs.writeFile(
      getDownloadsIndexPath(),
      `${JSON.stringify({ version: 1, jobs: [staleJob] }, null, 2)}\n`,
      'utf8',
    );

    await resetDownloadsForTests();
    const jobs = await listDownloads();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'failed');
    assert.match(jobs[0].error ?? '', /server restarted/i);
    await assert.rejects(() => fs.stat(`${destPath}.partial`));
  });

  test('downloadHfFile rejects truncated streams', async () => {
    globalThis.fetch = async () =>
      new Response(ReadableStream.from([Buffer.from('abc')]), {
        status: 200,
        headers: { 'Content-Length': '9' },
      });

    const destPath = path.join(homeDir, 'truncated.gguf');
    await assert.rejects(
      () =>
        downloadHfFile({
          repoId: 'org/demo',
          filename: 'model-Q4_K_M.gguf',
          destPath,
        }),
      /Incomplete download/,
    );
    await assert.rejects(() => fs.stat(destPath));
  });

  test('startDownload completes a mocked HF file', async () => {
    await resetDownloadsForTests();

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/api/models/') && url.includes('/tree/main')) {
        return new Response(
          JSON.stringify([{ path: 'model-Q4_K_M.gguf', size: 11, type: 'file' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/resolve/main/')) {
        const body = Buffer.from('hello-gguf');
        return new Response(body, {
          status: 200,
          headers: { 'Content-Length': String(body.length) },
        });
      }
      return ORIGINAL_FETCH(input);
    };

    const job = await startDownload({ repoId: 'org/demo', filename: 'model-Q4_K_M.gguf' });

    let final = null;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const jobs = await listDownloads();
      final = jobs.find((row) => row.id === job.id) ?? null;
      if (final?.status === 'completed' || final?.status === 'failed') break;
    }

    assert.equal(final?.status, 'completed');
    assert.equal(final?.bytesReceived, 10);
    const stat = await fs.stat(final.destPath);
    assert.equal(stat.size, 10);
  });
});
