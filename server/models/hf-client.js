/**
 * Hugging Face Hub helpers — list GGUF files and stream downloads.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getModelsConfig } from './models-config.js';
import { validateGgufFilename, validateRepoId } from './validate.js';

/** Cached config token to avoid disk read on every HEAD. */
let configTokenCache = { value: '', at: 0 };

/**
 * Resolve HF token from env vars (sync path for tests).
 */
export function resolveHfToken() {
  const env = (process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || '').trim();
  if (env) return env;
  return configTokenCache.value;
}

/**
 * Resolve HF token: env first, then config.json → models.hfToken.
 */
export async function resolveHfTokenAsync() {
  const env = (process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || '').trim();
  if (env) return env;
  const now = Date.now();
  if (now - configTokenCache.at < 5_000 && configTokenCache.value) {
    return configTokenCache.value;
  }
  const models = await getModelsConfig();
  const token = typeof models.hfToken === 'string' ? models.hfToken.trim() : '';
  configTokenCache = { value: token, at: now };
  return token;
}

/** Clear token cache after config updates (tests + settings save). */
export function resetHfTokenCache() {
  configTokenCache = { value: '', at: 0 };
}

/**
 * @param {string} repoId
 * @param {string} [token]
 */
function hfHeaders(token) {
  const headers = { 'User-Agent': 'Minnow/1.0' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * List files in a HF repo (main branch).
 * @param {string} repoId
 * @param {{ recursive?: boolean }} [options]
 * @returns {Promise<Array<{ path: string, size?: number }>>}
 */
export async function listRepoFiles(repoId, options = {}) {
  validateRepoId(repoId);
  const token = await resolveHfTokenAsync();
  const recursive = options.recursive === true ? '?recursive=true' : '';
  const url = `https://huggingface.co/api/models/${repoId}/tree/main${recursive}`;
  const res = await fetch(url, { headers: hfHeaders(token) });
  if (!res.ok) {
    throw new Error(`Hugging Face list failed (${res.status})`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((row) => row && typeof row.path === 'string')
    .filter((row) => row.type === 'file' || row.type === undefined)
    .map((row) => ({ path: row.path, size: typeof row.size === 'number' ? row.size : undefined }));
}

/** Recursively list all files in a HF repo. */
export async function listRepoFilesRecursive(repoId) {
  return listRepoFiles(repoId, { recursive: true });
}

/**
 * Pick a GGUF filename for a quant tier from repo listing.
 * @param {string} repoId
 * @param {string} [quant] e.g. Q4_K_M
 */
export async function resolveGgufFilename(repoId, quant = 'Q4_K_M') {
  const files = await listRepoFiles(repoId);
  const ggufs = files
    .map((f) => f.path)
    .filter((p) => p.toLowerCase().endsWith('.gguf'));
  if (!ggufs.length) {
    throw new Error(`No GGUF files found in ${repoId}`);
  }

  const q = (quant || 'Q4_K_M').toUpperCase();
  const ranked = [
    ggufs.find((name) => name.toUpperCase().includes(q)),
    ggufs.find((name) => name.toUpperCase().includes('Q4_K_M')),
    ggufs.find((name) => name.toUpperCase().includes('Q4')),
    ggufs[0],
  ].filter(Boolean);
  return ranked[0];
}

/**
 * HEAD request for remote content length.
 * @param {string} repoId
 * @param {string} filename
 */
export async function fetchRemoteSize(repoId, filename) {
  validateRepoId(repoId);
  validateGgufFilename(filename);
  const token = await resolveHfTokenAsync();
  const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
  const res = await fetch(url, { method: 'HEAD', headers: hfHeaders(token), redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Hugging Face HEAD failed (${res.status})`);
  }
  const len = res.headers.get('content-length');
  return len ? Number(len) : null;
}

/**
 * Stream a HF file to disk with progress callbacks.
 * @param {{ repoId: string, filename: string, destPath: string, signal?: AbortSignal, onProgress?: (bytes: number, total: number | null) => void }} opts
 */
export async function downloadHfFile({ repoId, filename, destPath, signal, onProgress }) {
  validateRepoId(repoId);
  validateGgufFilename(filename);
  const token = await resolveHfTokenAsync();
  const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
  const res = await fetch(url, { headers: hfHeaders(token), redirect: 'follow', signal });
  if (!res.ok || !res.body) {
    throw new Error(`Hugging Face download failed (${res.status})`);
  }

  const totalHeader = res.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : null;
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  const tmpPath = `${destPath}.partial`;
  const file = fs.createWriteStream(tmpPath);
  const reader = res.body.getReader();
  let bytesReceived = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('Download cancelled');
      }
      const { done, value } = await reader.read();
      if (done) break;
      bytesReceived += value.byteLength;
      if (!file.write(value)) {
        await new Promise((resolve) => file.once('drain', resolve));
      }
      onProgress?.(bytesReceived, totalBytes);
    }
  } catch (err) {
    file.destroy();
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  await new Promise((resolve, reject) => {
    file.end(() => resolve());
    file.on('error', reject);
  });

  await fsp.rename(tmpPath, destPath);
  return { bytesReceived, totalBytes: totalBytes ?? bytesReceived };
}

/**
 * Validate a HF repo-relative file path (no traversal).
 * @param {string} filename
 */
export function validateRepoFilePath(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid file path');
  }
  if (filename.includes('..') || filename.startsWith('/') || filename.includes('\\')) {
    throw new Error('Invalid file path');
  }
  return filename;
}

/**
 * Stream any HF repo file to disk (voice snapshots, not only GGUF).
 * @param {{ repoId: string, filename: string, destPath: string, signal?: AbortSignal, onProgress?: (bytes: number, total: number | null) => void }} opts
 */
export async function downloadHfRepoFile({ repoId, filename, destPath, signal, onProgress }) {
  validateRepoId(repoId);
  validateRepoFilePath(filename);
  const token = await resolveHfTokenAsync();
  const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
  const res = await fetch(url, { headers: hfHeaders(token), redirect: 'follow', signal });
  if (!res.ok || !res.body) {
    throw new Error(`Hugging Face download failed (${res.status}) for ${filename}`);
  }

  const totalHeader = res.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : null;
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  const tmpPath = `${destPath}.partial`;
  const file = fs.createWriteStream(tmpPath);
  const reader = res.body.getReader();
  let bytesReceived = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('Download cancelled');
      }
      const { done, value } = await reader.read();
      if (done) break;
      bytesReceived += value.byteLength;
      if (!file.write(value)) {
        await new Promise((resolve) => file.once('drain', resolve));
      }
      onProgress?.(bytesReceived, totalBytes);
    }
  } catch (err) {
    file.destroy();
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  await new Promise((resolve, reject) => {
    file.end(() => resolve());
    file.on('error', reject);
  });

  await fsp.rename(tmpPath, destPath);
  return { bytesReceived, totalBytes: totalBytes ?? bytesReceived };
}

/**
 * Download all files in a HF repo snapshot to a directory.
 * @param {{ repoId: string, destDir: string, signal?: AbortSignal, onProgress?: (bytes: number, total: number | null) => void }} opts
 */
export async function downloadHfSnapshot({ repoId, destDir, signal, onProgress }) {
  validateRepoId(repoId);
  const files = await listRepoFilesRecursive(repoId);
  if (!files.length) {
    throw new Error(`No files found in ${repoId}`);
  }

  const totalBytes = files.reduce((sum, f) => sum + (f.size ?? 0), 0) || null;
  let completedBytes = 0;

  for (const file of files) {
    if (signal?.aborted) {
      throw new Error('Download cancelled');
    }
    const destPath = path.join(destDir, file.path);
    let fileBytes = 0;
    const result = await downloadHfRepoFile({
      repoId,
      filename: file.path,
      destPath,
      signal,
      onProgress: (received) => {
        fileBytes = received;
        onProgress?.(completedBytes + fileBytes, totalBytes);
      },
    });
    completedBytes += result.bytesReceived;
    onProgress?.(completedBytes, totalBytes);
  }

  return { bytesReceived: completedBytes, totalBytes };
}
