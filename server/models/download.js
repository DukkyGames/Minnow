/**
 * Model download job store, progress SSE, and cancellation.
 */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getModelsConfig } from './models-config.js';
import {
  downloadHfFile,
  fetchRemoteSize,
  resolveGgufFilename,
} from './hf-client.js';
import { getDownloadsIndexPath, repoDownloadDir } from './paths.js';
import { validateJobId, validateRepoId } from './validate.js';

/** Minimum free bytes required before starting a download (500 MB). */
const MIN_FREE_BYTES = 500 * 1024 * 1024;

/** @typedef {'queued' | 'running' | 'completed' | 'failed' | 'cancelled'} DownloadStatus */

/**
 * @typedef {object} DownloadJob
 * @property {string} id
 * @property {string} repoId
 * @property {string} filename
 * @property {string} quant
 * @property {DownloadStatus} status
 * @property {number} bytesReceived
 * @property {number | null} totalBytes
 * @property {string} destPath
 * @property {string} [error]
 * @property {number} createdAt
 * @property {number} [finishedAt]
 */

/** @type {Map<string, AbortController>} */
const abortByJob = new Map();

/** @type {Map<string, Set<(event: object) => void>>} */
const listenersByJob = new Map();

/** @type {DownloadJob[]} */
let jobsCache = [];

let loaded = false;

function emit(jobId, event) {
  const set = listenersByJob.get(jobId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

async function loadJobs() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fsp.readFile(getDownloadsIndexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    jobsCache = Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    jobsCache = [];
  }
}

async function saveJobs() {
  await fsp.mkdir(path.dirname(getDownloadsIndexPath()), { recursive: true });
  await fsp.writeFile(
    getDownloadsIndexPath(),
    `${JSON.stringify({ version: 1, jobs: jobsCache }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * @param {string} jobId
 */
function findJob(jobId) {
  return jobsCache.find((j) => j.id === jobId) ?? null;
}

/**
 * Best-effort free disk space check for the models directory parent.
 * @param {number} requiredBytes
 */
async function assertDiskSpace(requiredBytes) {
  const targetDir = repoDownloadDir('_probe');
  await fsp.mkdir(path.dirname(targetDir), { recursive: true });
  try {
    const { statfs } = await import('node:fs/promises');
    const stats = await statfs(path.dirname(targetDir));
    const free = Number(stats.bfree) * Number(stats.bsize);
    const need = Math.max(requiredBytes, MIN_FREE_BYTES);
    if (free < need) {
      throw new Error(
        `Not enough disk space (need ~${Math.ceil(need / (1024 ** 3))} GB free)`,
      );
    }
  } catch (err) {
    if (err && err.message?.includes('Not enough disk space')) throw err;
    /* statfs unavailable — skip strict check */
  }
}

/**
 * @param {DownloadJob} job
 */
async function runDownloadJob(job) {
  const controller = new AbortController();
  abortByJob.set(job.id, controller);

  job.status = 'running';
  await saveJobs();
  emit(job.id, {
    jobId: job.id,
    status: job.status,
    bytesReceived: job.bytesReceived,
    totalBytes: job.totalBytes,
  });

  try {
    const result = await downloadHfFile({
      repoId: job.repoId,
      filename: job.filename,
      destPath: job.destPath,
      signal: controller.signal,
      onProgress: (bytes, total) => {
        job.bytesReceived = bytes;
        if (total != null) job.totalBytes = total;
        emit(job.id, {
          jobId: job.id,
          status: job.status,
          bytesReceived: job.bytesReceived,
          totalBytes: job.totalBytes,
        });
      },
    });
    job.bytesReceived = result.bytesReceived;
    job.totalBytes = result.totalBytes;
    job.status = 'completed';
    job.finishedAt = Date.now();
    emit(job.id, {
      jobId: job.id,
      status: job.status,
      bytesReceived: job.bytesReceived,
      totalBytes: job.totalBytes,
    });
  } catch (err) {
    const cancelled = controller.signal.aborted || err?.message === 'Download cancelled';
    job.status = cancelled ? 'cancelled' : 'failed';
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = Date.now();
    await fsp.rm(job.destPath, { force: true }).catch(() => {});
    await fsp.rm(`${job.destPath}.partial`, { force: true }).catch(() => {});
    emit(job.id, {
      jobId: job.id,
      status: job.status,
      bytesReceived: job.bytesReceived,
      totalBytes: job.totalBytes,
      error: job.error,
    });
  } finally {
    abortByJob.delete(job.id);
    await saveJobs();
  }
}

/**
 * @param {{ repoId: string, filename?: string, quant?: string, catalogName?: string }} body
 */
export async function startDownload(body) {
  await loadJobs();
  const repoId = validateRepoId(body.repoId);
  const quant = typeof body.quant === 'string' && body.quant.trim() ? body.quant.trim() : 'Q4_K_M';
  const filename =
    typeof body.filename === 'string' && body.filename.trim()
      ? body.filename.trim()
      : await resolveGgufFilename(repoId, quant);

  const destDir = repoDownloadDir(repoId);
  const destPath = path.join(destDir, filename);

  let totalBytes = null;
  try {
    totalBytes = await fetchRemoteSize(repoId, filename);
  } catch {
    /* size unknown until stream starts */
  }

  if (totalBytes != null) {
    await assertDiskSpace(totalBytes + MIN_FREE_BYTES);
  } else {
    await assertDiskSpace(MIN_FREE_BYTES);
  }

  const job = /** @type {DownloadJob} */ ({
    id: crypto.randomUUID(),
    repoId,
    filename,
    quant,
    status: 'queued',
    bytesReceived: 0,
    totalBytes,
    destPath,
    createdAt: Date.now(),
  });

  jobsCache.unshift(job);
  if (jobsCache.length > 100) jobsCache.length = 100;
  await saveJobs();

  void runDownloadJob(job);
  return publicJob(job);
}

/**
 * @param {DownloadJob} job
 */
function publicJob(job) {
  return {
    id: job.id,
    repoId: job.repoId,
    filename: job.filename,
    quant: job.quant,
    status: job.status,
    bytesReceived: job.bytesReceived,
    totalBytes: job.totalBytes,
    destPath: job.destPath,
    error: job.error ?? null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt ?? null,
  };
}

export async function listDownloads() {
  await loadJobs();
  return jobsCache.map(publicJob);
}

/**
 * @param {string} jobId
 */
export async function cancelDownload(jobId) {
  await loadJobs();
  validateJobId(jobId);
  const job = findJob(jobId);
  if (!job) {
    throw new Error('Download job not found');
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return publicJob(job);
  }
  const controller = abortByJob.get(jobId);
  if (controller) controller.abort();
  return publicJob(job);
}

/**
 * @param {string} jobId
 * @param {(event: object) => void} listener
 */
export function subscribeDownload(jobId, listener) {
  validateJobId(jobId);
  if (!listenersByJob.has(jobId)) listenersByJob.set(jobId, new Set());
  listenersByJob.get(jobId).add(listener);
  const job = findJob(jobId);
  if (job) {
    listener({
      jobId: job.id,
      status: job.status,
      bytesReceived: job.bytesReceived,
      totalBytes: job.totalBytes,
      error: job.error ?? null,
    });
  }
  return () => {
    listenersByJob.get(jobId)?.delete(listener);
  };
}

/** Test helper — reset module state. */
export async function resetDownloadsForTests() {
  jobsCache = [];
  loaded = false;
  abortByJob.clear();
  listenersByJob.clear();
}

export { getModelsConfig } from './models-config.js';
