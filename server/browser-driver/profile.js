import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getMinnowHome } from '../config/home.js';

export function browserProfileRoot() {
  return path.join(getMinnowHome(), 'browser-profiles');
}

/**
 * @param {string} [label]
 * @returns {Promise<string>}
 */
export async function createProfileDir(label) {
  const safe = String(label ?? 'run')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 40) || 'run';
  const dir = path.join(
    browserProfileRoot(),
    `${safe}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} dir
 * @returns {Promise<{ removed: boolean, error?: string }>}
 */
export async function removeProfileDir(dir) {
  if (!dir) return { removed: false, error: 'no directory' };
  const root = browserProfileRoot();
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(root)) {
    return { removed: false, error: 'refusing to remove profile root' };
  }
  try {
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    return { removed: true };
  } catch (err) {
    return { removed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @param {number} [olderThanMs]
 * @returns {Promise<{ removed: string[], failed: string[] }>}
 */
export async function sweepStaleProfiles(olderThanMs = 24 * 60 * 60 * 1000) {
  const root = browserProfileRoot();
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const failed = [];
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return { removed, failed };
  }
  const cutoff = Date.now() - olderThanMs;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs > cutoff) continue;
    } catch {
      continue;
    }
    const result = await removeProfileDir(full);
    (result.removed ? removed : failed).push(full);
  }
  return { removed, failed };
}
