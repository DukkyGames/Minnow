/**
 * Voice model download jobs — HF snapshot downloads to ~/.minnow/models/voice/.
 */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { downloadHfSnapshot, listRepoFilesRecursive } from '../models/hf-client.js';
import { validateJobId, validateRepoId } from '../models/validate.js';
import {
  getVoiceDownloadsIndexPath,
  getVoiceInstalledPath,
  getVoiceModelsRoot,
  voiceModelDir,
} from './paths.js';
import { isSttCatalogModel } from './stt-catalog.js';
import { QWEN_TOKENIZER_MODEL_ID, resolveTtsCatalogMeta } from './tts-catalog.js';

/** Minimum free bytes before starting a voice download (500 MB). */
const MIN_FREE_BYTES = 500 * 1024 * 1024;

/** @typedef {'queued' | 'running' | 'completed' | 'failed' | 'cancelled'} VoiceDownloadStatus */
/** @typedef {'stt' | 'tts'} VoiceModelKind */

/**
 * @typedef {object} VoiceDownloadJob
 * @property {string} id
 * @property {VoiceModelKind} kind
 * @property {string} modelId
 * @property {VoiceDownloadStatus} status
 * @property {number} bytesReceived
 * @property {number | null} totalBytes
 * @property {string} destDir
 * @property {string} [error]
 * @property {number} createdAt
 * @property {number} [finishedAt]
 */

/** @type {Map<string, AbortController>} */
const abortByJob = new Map();

/** @type {Map<string, Set<(event: object) => void>>} */
const listenersByJob = new Map();

/** @type {VoiceDownloadJob[]} */
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
    const raw = await fsp.readFile(getVoiceDownloadsIndexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    jobsCache = Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    jobsCache = [];
  }
}

async function saveJobs() {
  await fsp.mkdir(path.dirname(getVoiceDownloadsIndexPath()), { recursive: true });
  await fsp.writeFile(
    getVoiceDownloadsIndexPath(),
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
 * @param {VoiceModelKind} kind
 */
function validateKind(kind) {
  if (kind !== 'stt' && kind !== 'tts') {
    throw new Error('Invalid kind — expected stt or tts');
  }
  return kind;
}

/**
 * @param {number} requiredBytes
 */
async function assertDiskSpace(requiredBytes) {
  const targetDir = getVoiceModelsRoot();
  await fsp.mkdir(targetDir, { recursive: true });
  try {
    const { statfs } = await import('node:fs/promises');
    const stats = await statfs(targetDir);
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
 * @typedef {object} InstalledVoiceModel
 * @property {string} modelId
 * @property {string} path
 * @property {number} installedAt
 * @property {number} [sizeBytes]
 * @property {'stt' | 'tts'} [kind]
 * @property {'custom_voice' | 'voice_design' | 'voice_clone' | 'tokenizer'} [mode]
 */

/**
 * Map a voice models directory name back to a HuggingFace repo id.
 * @param {string} dirName
 */
function dirNameToModelId(dirName) {
  return dirName.replace(/--/g, '/');
}

/**
 * Classify an on-disk voice model as STT or TTS using catalog metadata.
 * @param {string} modelId
 * @returns {'stt' | 'tts' | null}
 */
function classifyVoiceModelKind(modelId) {
  if (isSttCatalogModel(modelId)) return 'stt';
  const lower = modelId.toLowerCase();
  if (lower.includes('tts') || lower.includes('tokenizer') || lower.includes('qwen3-tts')) {
    return 'tts';
  }
  return null;
}

/**
 * @param {string} destDir
 */
async function computeDirSizeBytes(destDir) {
  let sizeBytes = 0;
  try {
    const walk = async (current) => {
      const entries = await fsp.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const stat = await fsp.stat(full);
          sizeBytes += stat.size;
        }
      }
    };
    await walk(destDir);
  } catch {
    sizeBytes = 0;
  }
  return sizeBytes;
}

/**
 * Scan ~/.minnow/models/voice for HF snapshot folders and rebuild the manifest.
 * @returns {Promise<{ version: number, stt: InstalledVoiceModel[], tts: InstalledVoiceModel[] }>}
 */
async function rebuildInstalledManifestFromDisk() {
  const manifest = { version: 1, stt: [], tts: [] };
  const modelsRoot = getVoiceModelsRoot();
  let entries = [];
  try {
    entries = await fsp.readdir(modelsRoot, { withFileTypes: true });
  } catch {
    return manifest;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modelId = dirNameToModelId(entry.name);
    const kind = classifyVoiceModelKind(modelId);
    if (!kind) continue;

    const destDir = path.join(modelsRoot, entry.name);
    let installedAt = Date.now();
    try {
      const stat = await fsp.stat(destDir);
      installedAt = Math.trunc(stat.mtimeMs);
    } catch {
      /* keep default installedAt */
    }

    const row = /** @type {InstalledVoiceModel} */ ({
      modelId,
      path: destDir,
      installedAt,
      sizeBytes: await computeDirSizeBytes(destDir),
      kind,
      ...(kind === 'tts' ? { mode: resolveTtsCatalogMeta(modelId).mode } : {}),
    });

    if (kind === 'stt') manifest.stt.push(row);
    else manifest.tts.push(row);
  }

  manifest.stt.sort((a, b) => b.installedAt - a.installedAt);
  manifest.tts.sort((a, b) => b.installedAt - a.installedAt);
  await writeInstalledManifest(manifest);
  return manifest;
}

/**
 * @returns {Promise<{ version: number, stt: InstalledVoiceModel[], tts: InstalledVoiceModel[] }>}
 */
async function readInstalledManifestFile() {
  try {
    const raw = await fsp.readFile(getVoiceInstalledPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      stt: Array.isArray(parsed.stt) ? parsed.stt : [],
      tts: Array.isArray(parsed.tts) ? parsed.tts : [],
    };
  } catch {
    return { version: 1, stt: [], tts: [] };
  }
}

/**
 * Whether any HF snapshot folders exist under the voice models root.
 */
async function hasVoiceModelsOnDisk() {
  try {
    const entries = await fsp.readdir(getVoiceModelsRoot(), { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

/**
 * @param {{ version: number, stt: InstalledVoiceModel[], tts: InstalledVoiceModel[] }} manifest
 */
async function shouldRebuildManifest(manifest) {
  if (manifest.stt.length > 0 || manifest.tts.length > 0) return false;
  return hasVoiceModelsOnDisk();
}

/**
 * @param {{ rebuildFromDisk?: boolean }} [options]
 * @returns {Promise<{ version: number, stt: InstalledVoiceModel[], tts: InstalledVoiceModel[] }>}
 */
async function readInstalledManifest({ rebuildFromDisk = false } = {}) {
  const manifest = await readInstalledManifestFile();
  if (rebuildFromDisk && (await shouldRebuildManifest(manifest))) {
    return rebuildInstalledManifestFromDisk();
  }
  return manifest;
}

/**
 * @param {{ version: number, stt: InstalledVoiceModel[], tts: InstalledVoiceModel[] }} manifest
 */
async function writeInstalledManifest(manifest) {
  await fsp.mkdir(path.dirname(getVoiceInstalledPath()), { recursive: true });
  await fsp.writeFile(getVoiceInstalledPath(), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * Register a completed download in the installed manifest.
 * @param {VoiceModelKind} kind
 * @param {string} modelId
 * @param {string} destDir
 * @param {{ mode?: string }} [options]
 */
async function registerInstalledModel(kind, modelId, destDir, options = {}) {
  const manifest = await readInstalledManifest();
  const list = kind === 'stt' ? manifest.stt : manifest.tts;
  const filtered = list.filter((row) => row.modelId !== modelId);
  const sizeBytes = await computeDirSizeBytes(destDir);
  filtered.unshift({
    modelId,
    path: destDir,
    installedAt: Date.now(),
    sizeBytes,
    kind,
    ...(options.mode ? { mode: options.mode } : {}),
  });
  if (kind === 'stt') manifest.stt = filtered;
  else manifest.tts = filtered;
  await writeInstalledManifest(manifest);
}

/**
 * Download the Qwen tokenizer dependency when a TTS model requires it.
 * @param {string} parentJobId
 * @param {AbortSignal} signal
 * @param {(bytes: number, total: number | null) => void} onProgress
 */
async function ensureTokenizerDownloaded(parentJobId, signal, onProgress) {
  const manifest = await readInstalledManifest();
  const hasTokenizer = manifest.tts.some((row) => row.modelId === QWEN_TOKENIZER_MODEL_ID);
  if (hasTokenizer) return;

  const destDir = voiceModelDir(QWEN_TOKENIZER_MODEL_ID);
  const result = await downloadHfSnapshot({
    repoId: QWEN_TOKENIZER_MODEL_ID,
    destDir,
    signal,
    onProgress: (bytes, total) => onProgress(bytes, total),
  });
  await registerInstalledModel('tts', QWEN_TOKENIZER_MODEL_ID, destDir, { mode: 'tokenizer' });
  emit(parentJobId, {
    jobId: parentJobId,
    status: 'running',
    bytesReceived: result.bytesReceived,
    totalBytes: result.totalBytes,
    message: 'Tokenizer dependency installed',
  });
}

/**
 * @param {VoiceDownloadJob} job
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
    const result = await downloadHfSnapshot({
      repoId: job.modelId,
      destDir: job.destDir,
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
    if (job.kind === 'tts') {
      const meta = resolveTtsCatalogMeta(job.modelId);
      if (meta.requiresTokenizer) {
        await ensureTokenizerDownloaded(job.id, controller.signal, (bytes, total) => {
          job.bytesReceived += bytes;
          if (total != null) {
            job.totalBytes = (job.totalBytes ?? 0) + total;
          }
          emit(job.id, {
            jobId: job.id,
            status: job.status,
            bytesReceived: job.bytesReceived,
            totalBytes: job.totalBytes,
          });
        });
      }
    }

    job.status = 'completed';
    job.finishedAt = Date.now();
    const ttsMode = job.kind === 'tts' ? resolveTtsCatalogMeta(job.modelId).mode : undefined;
    await registerInstalledModel(job.kind, job.modelId, job.destDir, { mode: ttsMode });
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
    await fsp.rm(job.destDir, { recursive: true, force: true }).catch(() => {});
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
 * @param {VoiceDownloadJob} job
 */
function publicJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    modelId: job.modelId,
    status: job.status,
    bytesReceived: job.bytesReceived,
    totalBytes: job.totalBytes,
    destDir: job.destDir,
    error: job.error ?? null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt ?? null,
  };
}

/**
 * @param {{ modelId: string, kind: VoiceModelKind }} body
 */
export async function startVoiceDownload(body) {
  await loadJobs();
  const kind = validateKind(body.kind);
  const modelId = validateRepoId(String(body.modelId || '').trim());

  const destDir = voiceModelDir(modelId);
  const existing = await readInstalledManifest({ rebuildFromDisk: true });
  const list = kind === 'stt' ? existing.stt : existing.tts;
  const already = list.some((row) => row.modelId === modelId);
  if (already) {
    throw new Error(`Model already installed: ${modelId}`);
  }

  if (kind === 'tts' && resolveTtsCatalogMeta(modelId).mode === 'tokenizer') {
    throw new Error('Download a TTS model — the tokenizer is installed automatically when required');
  }

  let totalBytes = null;
  try {
    const files = await listRepoFilesRecursive(modelId);
    const sum = files.reduce((acc, f) => acc + (f.size ?? 0), 0);
    totalBytes = sum > 0 ? sum : null;
  } catch {
    /* size unknown until stream starts */
  }

  if (totalBytes != null) {
    await assertDiskSpace(totalBytes + MIN_FREE_BYTES);
  } else {
    await assertDiskSpace(MIN_FREE_BYTES);
  }

  const job = /** @type {VoiceDownloadJob} */ ({
    id: crypto.randomUUID(),
    kind,
    modelId,
    status: 'queued',
    bytesReceived: 0,
    totalBytes,
    destDir,
    createdAt: Date.now(),
  });

  jobsCache.unshift(job);
  if (jobsCache.length > 100) jobsCache.length = 100;
  await saveJobs();

  void runDownloadJob(job);
  return publicJob(job);
}

export async function listVoiceDownloads() {
  await loadJobs();
  return jobsCache.map(publicJob);
}

/**
 * @param {string} jobId
 */
export async function cancelVoiceDownload(jobId) {
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
export function subscribeVoiceDownload(jobId, listener) {
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

export async function listInstalledVoiceModels() {
  return readInstalledManifest({ rebuildFromDisk: true });
}

/**
 * @param {VoiceModelKind} kind
 * @param {string} modelId
 */
export async function deleteVoiceModel(kind, modelId) {
  const normalizedKind = validateKind(kind);
  const normalizedId = validateRepoId(String(modelId || '').trim());
  const manifest = await readInstalledManifest({ rebuildFromDisk: true });
  const list = normalizedKind === 'stt' ? manifest.stt : manifest.tts;
  const entry = list.find((row) => row.modelId === normalizedId);
  if (!entry) {
    throw new Error('Installed model not found');
  }
  await fsp.rm(entry.path, { recursive: true, force: true }).catch(() => {});
  const next = list.filter((row) => row.modelId !== normalizedId);
  if (normalizedKind === 'stt') manifest.stt = next;
  else manifest.tts = next;
  await writeInstalledManifest(manifest);
  return { ok: true, modelId: normalizedId, kind: normalizedKind };
}

/** Test helper — reset module state. */
export async function resetVoiceDownloadsForTests() {
  jobsCache = [];
  loaded = false;
  abortByJob.clear();
  listenersByJob.clear();
  try {
    await fsp.rm(getVoiceDownloadsIndexPath(), { force: true });
  } catch {
    /* ignore */
  }
  try {
    await fsp.rm(getVoiceInstalledPath(), { force: true });
  } catch {
    /* ignore */
  }
}
