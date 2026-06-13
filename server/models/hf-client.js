/**
 * Hugging Face Hub helpers — list GGUF files and stream downloads.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { validateGgufFilename, validateRepoId } from './validate.js';

/**
 * Resolve HF token from env (optional gated models).
 */
export function resolveHfToken() {
  return (
    (process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || '').trim() || ''
  );
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
 * List sibling files in a HF repo (main branch).
 * @param {string} repoId
 * @returns {Promise<Array<{ path: string, size?: number }>>}
 */
export async function listRepoFiles(repoId) {
  validateRepoId(repoId);
  const token = resolveHfToken();
  const url = `https://huggingface.co/api/models/${repoId}/tree/main`;
  const res = await fetch(url, { headers: hfHeaders(token) });
  if (!res.ok) {
    throw new Error(`Hugging Face list failed (${res.status})`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((row) => row && typeof row.path === 'string')
    .map((row) => ({ path: row.path, size: typeof row.size === 'number' ? row.size : undefined }));
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
  const token = resolveHfToken();
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
  const token = resolveHfToken();
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
