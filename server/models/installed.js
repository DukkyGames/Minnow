/**
 * Scan installed model artifacts on disk.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { getModelsRoot, repoDownloadDir } from './paths.js';
import { listDownloads } from './download.js';

/**
 * @typedef {object} InstalledArtifact
 * @property {string} repoId
 * @property {string} filename
 * @property {string} path
 * @property {number} sizeBytes
 * @property {number} mtimeMs
 */

/**
 * @returns {Promise<InstalledArtifact[]>}
 */
export async function scanInstalledArtifacts() {
  const root = path.join(getModelsRoot(), 'artifacts');
  const out = [];
  let entries = [];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoKey = entry.name;
    const repoId = repoKey.replace(/--/g, '/');
    const dir = repoDownloadDir(repoId);
    let files = [];
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const filename of files) {
      if (!filename.toLowerCase().endsWith('.gguf')) continue;
      const full = path.join(dir, filename);
      try {
        const stat = await fsp.stat(full);
        if (!stat.isFile()) continue;
        out.push({
          repoId,
          filename,
          path: full,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        /* skip unreadable */
      }
    }
  }

  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/**
 * Combined installed view: artifacts + recent download jobs.
 */
export async function listInstalled() {
  const [artifacts, downloads] = await Promise.all([
    scanInstalledArtifacts(),
    listDownloads(),
  ]);
  return { artifacts, downloads };
}
