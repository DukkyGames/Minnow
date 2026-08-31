/**
 * P5-A — Per-run browser profile directories (MIN-719).
 *
 * Isolation requirement: a driven browser shares **no** state with the user's
 * Chrome — no cookies, no localStorage, no extensions, no history — and two
 * sequential runs share nothing with each other either. That is bought by a
 * fresh `--user-data-dir` per session plus a teardown that actually succeeds on
 * Windows, where Chrome keeps file handles open for a moment after exit.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getMinnowHome } from '../config/home.js';

/** Parent of every driver profile. Never the user's Chrome data dir. */
export function browserProfileRoot() {
  return path.join(getMinnowHome(), 'browser-profiles');
}

/**
 * Mint an empty profile directory for one session.
 * @param {string} [label] short, filename-safe hint (e.g. a boardId)
 * @returns {Promise<string>} absolute path
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
 * Remove a profile directory.
 *
 * Best-effort by contract: a leftover directory is a disk-space annoyance, but
 * throwing here would turn a successful verification into a failed one. The
 * retry loop exists because on win32 `rm` races Chrome's own handle release.
 *
 * @param {string} dir
 * @returns {Promise<{ removed: boolean, error?: string }>}
 */
export async function removeProfileDir(dir) {
  if (!dir) return { removed: false, error: 'no directory' };
  const root = browserProfileRoot();
  const resolved = path.resolve(dir);
  // Guard: only ever delete inside our own root unless the caller passed a dir
  // we minted elsewhere (tests pass tmpdir paths). Refuse obvious footguns.
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
 * Delete profile directories left behind by a crashed host.
 * Not called automatically — the engine can schedule it.
 * @param {number} [olderThanMs] default 24h
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
