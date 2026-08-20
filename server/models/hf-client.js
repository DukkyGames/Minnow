/**
 * Hugging Face Hub helpers — list GGUF files and stream downloads.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getModelsConfig } from './models-config.js';
import { expandSplitGgufFilenames } from './split-gguf.js';
import { validateGgufFilename, validateRepoId } from './validate.js';

/** Cached config token to avoid disk read on every HEAD. */
let configTokenCache = { value: '', at: 0 };

/** Abort fetch/read when no bytes arrive for this long (2 min). */
const DOWNLOAD_STALL_MS = 120_000;

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
 * Rank listed GGUF paths for a quant, then expand split shards.
 * Ranking still picks one preferred name; a `-00001-of-00003` hit expands to every sibling.
 * @param {string[]} ggufs
 * @param {string} [quant]
 * @returns {string[]}
 */
export function pickGgufFilenames(ggufs, quant = 'Q4_K_M') {
  if (!ggufs.length) {
    throw new Error('No GGUF files found');
  }
  const q = (quant || 'Q4_K_M').toUpperCase();
  const ranked = [
    ggufs.find((name) => name.toUpperCase().includes(q)),
    ggufs.find((name) => name.toUpperCase().includes('Q4_K_M')),
    ggufs.find((name) => name.toUpperCase().includes('Q4')),
    ggufs[0],
  ].filter(Boolean);
  return expandSplitGgufFilenames(ranked[0], ggufs);
}

/**
 * Pick GGUF file(s) for a quant tier from the repo listing.
 * Returns every shard when the chosen name is a split GGUF.
 * @param {string} repoId
 * @param {string} [quant] e.g. Q4_K_M
 * @returns {Promise<string[]>}
 */
export async function resolveGgufFilename(repoId, quant = 'Q4_K_M') {
  const files = await listRepoFilesRecursive(repoId);
  const ggufs = files
    .map((f) => f.path)
    .filter((p) => p.toLowerCase().endsWith('.gguf'));
  if (!ggufs.length) {
    throw new Error(`No GGUF files found in ${repoId}`);
  }
  return pickGgufFilenames(ggufs, quant);
}

/**
 * HEAD request for remote content length.
 * @param {string} repoId
 * @param {string} filename
 */
export async function fetchRemoteSize(repoId, filename) {
  validateRepoId(repoId);
  const repoFilePath = filename.includes('/')
    ? validateRepoFilePath(filename)
    : validateGgufFilename(filename);
  const token = await resolveHfTokenAsync();
  const url = `https://huggingface.co/${repoId}/resolve/main/${encodeURI(repoFilePath)}`;
  const res = await fetch(url, { method: 'HEAD', headers: hfHeaders(token), redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Hugging Face HEAD failed (${res.status})`);
  }
  const len = res.headers.get('content-length');
  return len ? Number(len) : null;
}

/**
 * Read one chunk from a stream body, failing when the download stalls.
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {AbortSignal | undefined} signal
 */
async function readChunkWithStallTimeout(reader, signal) {
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Download stalled (no data received)'));
        }, DOWNLOAD_STALL_MS);
      }),
      new Promise((_, reject) => {
        if (!signal) return;
        if (signal.aborted) {
          reject(new Error('Download cancelled'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(new Error('Download cancelled')),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait until a write stream has flushed all buffered bytes.
 * @param {import('node:fs').WriteStream} file
 */
function finishWriteStream(file) {
  return new Promise((resolve, reject) => {
    file.on('finish', resolve);
    file.on('error', reject);
    file.end();
  });
}

/**
 * Hugging Face `X-Linked-Etag` is the sha256 of the LFS blob. Values are often
 * quoted, may carry a `W/` weak prefix, and sometimes a `sha256:` scheme.
 * Returns lowercase hex, or null when the header is absent / not a 64-char
 * digest — ordinary HTTP etags are not checksums, and tests without the header
 * still need to complete.
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function parseLinkedEtag(raw) {
  if (raw == null) return null;
  let value = String(raw).trim();
  if (!value) return null;
  if (value.startsWith('W/') || value.startsWith('w/')) value = value.slice(2).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (value.toLowerCase().startsWith('sha256:')) value = value.slice(7);
  value = value.trim();
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return value.toLowerCase();
}

/**
 * `bytes start-end/total` from a 206 Content-Range. Total may be `*`.
 * @param {string | null} header
 * @returns {{ start: number, end: number, total: number | null } | null}
 */
function parseContentRange(header) {
  if (!header) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(header.trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3]),
  };
}

/** Hash an existing `.partial` so a resumed digest covers the prefix, not just new bytes. */
async function hashFileInto(hasher, filePath) {
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hasher.update(chunk);
  }
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Follow redirects by hand so `Range` survives the hop to the HF CDN.
 * `redirect: 'follow'` can drop Range; Authorization stays on huggingface.co only.
 * @param {string} url
 * @param {{ token?: string, rangeStart?: number, signal?: AbortSignal }} opts
 */
async function fetchHfPreservingRange(url, { token, rangeStart = 0, signal } = {}) {
  let current = url;
  for (let hop = 0; hop < 8; hop += 1) {
    /** @type {Record<string, string>} */
    const headers = { 'User-Agent': 'Minnow/1.0' };
    try {
      const host = new URL(current).hostname;
      if (token && (host === 'huggingface.co' || host.endsWith('.huggingface.co'))) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (rangeStart > 0) headers.Range = `bytes=${rangeStart}-`;
    const res = await fetch(current, { headers, redirect: 'manual', signal });
    if (isRedirectStatus(res.status)) {
      const location = res.headers.get('location');
      if (res.body) await res.body.cancel().catch(() => {});
      if (!location) {
        throw new Error(`Hugging Face download failed (${res.status})`);
      }
      current = new URL(location, current).href;
      continue;
    }
    return res;
  }
  throw new Error('Hugging Face download failed (too many redirects)');
}

/**
 * Stream a fetch response onto `destPath` via `destPath.partial`.
 *
 * Resume: if the partial already has bytes, send `Range: bytes=<size>-`.
 * 206 appends; 200 (server ignored Range) truncates and restarts.
 * Errors leave the partial on disk — the next attempt resumes from its size.
 * @param {{ url: string, destPath: string, token?: string, signal?: AbortSignal, onProgress?: (bytes: number, total: number | null) => void, errorLabel?: string }} opts
 */
async function streamHfUrlToFile({ url, destPath, token, signal, onProgress, errorLabel }) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.partial`;

  // A completed dest is a successful prior rename — skip rather than re-fetch.
  try {
    const destStat = await fsp.stat(destPath);
    if (destStat.isFile() && destStat.size > 0) {
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      onProgress?.(destStat.size, destStat.size);
      return { bytesReceived: destStat.size, totalBytes: destStat.size };
    }
  } catch {
    /* dest missing — download or resume from .partial */
  }

  let resumeFrom = 0;
  try {
    const partialStat = await fsp.stat(tmpPath);
    if (partialStat.isFile() && partialStat.size > 0) resumeFrom = partialStat.size;
  } catch {
    resumeFrom = 0;
  }

  const res = await fetchHfPreservingRange(url, { token, rangeStart: resumeFrom, signal });
  if (!res.ok || !res.body) {
    const suffix = errorLabel ? ` for ${errorLabel}` : '';
    throw new Error(`Hugging Face download failed (${res.status})${suffix}`);
  }

  // 206 = continue from resumeFrom; 200 = rewrite the partial from byte 0.
  const append = res.status === 206;
  const writeFlags = append ? 'a' : 'w';
  const startOffset = append ? resumeFrom : 0;

  const contentRange = parseContentRange(res.headers.get('content-range'));
  const lengthHeader = res.headers.get('content-length');
  const length = lengthHeader ? Number(lengthHeader) : null;
  let totalBytes = null;
  if (append) {
    // Content-Length on a 206 is the remainder; Content-Range carries the full size.
    if (contentRange?.total != null) totalBytes = contentRange.total;
    else if (length != null) totalBytes = startOffset + length;
  } else if (length != null) {
    totalBytes = length;
  }

  const hasher = crypto.createHash('sha256');
  if (append && startOffset > 0) {
    await hashFileInto(hasher, tmpPath);
  }

  const file = fs.createWriteStream(tmpPath, { flags: writeFlags });
  const reader = res.body.getReader();
  let bytesReceived = startOffset;

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('Download cancelled');
      }
      const { done, value } = await readChunkWithStallTimeout(reader, signal);
      if (done) break;
      if (!value?.byteLength) continue;
      hasher.update(value);
      bytesReceived += value.byteLength;
      if (!file.write(value)) {
        await new Promise((resolve) => file.once('drain', resolve));
      }
      onProgress?.(bytesReceived, totalBytes);
    }
  } catch (err) {
    file.destroy();
    // Keep `.partial` so the next attempt can send Range from its size.
    throw err;
  }

  await finishWriteStream(file);

  if (totalBytes != null && bytesReceived < totalBytes) {
    throw new Error(`Incomplete download (${bytesReceived} of ${totalBytes} bytes)`);
  }

  const written = await fsp.stat(tmpPath);
  if (written.size !== bytesReceived) {
    throw new Error(`Incomplete download (file size mismatch)`);
  }

  // Skip verify when HF omitted the header (mirrors, tests, non-LFS files).
  const expected = parseLinkedEtag(res.headers.get('x-linked-etag'));
  if (expected) {
    const digest = hasher.digest('hex');
    if (digest !== expected) {
      throw new Error(`Checksum mismatch (sha256 ${digest} != ${expected})`);
    }
  }

  await fsp.rename(tmpPath, destPath);
  return { bytesReceived, totalBytes: totalBytes ?? bytesReceived };
}

/**
 * Stream a HF file to disk with progress callbacks.
 * @param {{ repoId: string, filename: string, destPath: string, signal?: AbortSignal, onProgress?: (bytes: number, total: number | null) => void }} opts
 */
export async function downloadHfFile({ repoId, filename, destPath, signal, onProgress }) {
  validateRepoId(repoId);
  const repoFilePath = validateRepoFilePath(filename);
  const token = await resolveHfTokenAsync();
  const url = `https://huggingface.co/${repoId}/resolve/main/${encodeURI(repoFilePath)}`;
  return streamHfUrlToFile({ url, destPath, token, signal, onProgress });
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
 * Stream any HF repo file to disk (MLX snapshots, not only GGUF).
 * Shares resume / checksum behaviour with `downloadHfFile`.
 * @param {{ repoId: string, filename: string, destPath: string, signal?: AbortSignal, onProgress?: (bytes: number, total: number | null) => void }} opts
 */
export async function downloadHfRepoFile({ repoId, filename, destPath, signal, onProgress }) {
  validateRepoId(repoId);
  validateRepoFilePath(filename);
  const token = await resolveHfTokenAsync();
  const url = `https://huggingface.co/${repoId}/resolve/main/${encodeURI(filename)}`;
  return streamHfUrlToFile({
    url,
    destPath,
    token,
    signal,
    onProgress,
    errorLabel: filename,
  });
}

/**
 * Glob → RegExp for snapshot filters. Supports `**` (any depth), `*` and `?`
 * (within one segment). Matching is case-insensitive so `.GGUF` is caught too.
 * @param {string} pattern
 */
function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` swallows zero or more leading segments; a trailing `**` takes the rest.
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/**
 * @param {string} filePath
 * @param {string[]} patterns
 */
function matchesAnyGlob(filePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(filePath));
}

/**
 * Sibling weights an MLX repo carries that mlx-lm never reads. Skipping these
 * routinely halves the transfer: `mlx-community` repos often keep the original
 * fp16 `.safetensors` under `original/` alongside the quantized copy.
 *
 * Opt-in, not a default — voice snapshots (Kokoro and friends) ship their real
 * weights as `.pth`/`.bin`, so excluding those globally would break TTS.
 */
export const MLX_SNAPSHOT_EXCLUDE = ['**/*.gguf', 'original/**', '**/*.pth', '**/*.bin'];

/**
 * Download all files in a HF repo snapshot to a directory.
 *
 * `include`/`exclude` take glob patterns matched against repo-relative paths.
 * `exclude` wins over `include`. Both default to unfiltered.
 * @param {{ repoId: string, destDir: string, signal?: AbortSignal, include?: string[], exclude?: string[], onProgress?: (bytes: number, total: number | null) => void }} opts
 */
export async function downloadHfSnapshot({
  repoId,
  destDir,
  signal,
  include,
  exclude,
  onProgress,
}) {
  validateRepoId(repoId);
  const listed = await listRepoFilesRecursive(repoId);
  if (!listed.length) {
    throw new Error(`No files found in ${repoId}`);
  }

  const files = listed.filter((file) => {
    if (include?.length && !matchesAnyGlob(file.path, include)) return false;
    if (exclude?.length && matchesAnyGlob(file.path, exclude)) return false;
    return true;
  });
  if (!files.length) {
    throw new Error(`No files in ${repoId} matched the download filter`);
  }

  // Sized off the filtered set, or progress would never reach its own total.
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
