/**
 * Workspace line-of-file counter for the Vibe Coding Hub (GET /api/workspace/loc).
 * Uses bundled ripgrep to list files; sums line counts with bounded scan.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getRipgrepPath } from '../lib/ripgrep-path.js';
import { getWorkspaceRoot } from './root.js';

const execFileAsync = promisify(execFile);

const rgExecutable = getRipgrepPath();

/** Cache TTL so hub refreshes stay cheap. */
const LOC_CACHE_TTL_MS = 45_000;

/** Max files enumerated per scan. */
const MAX_FILES = 5_000;

/** Skip individual files larger than this (bytes). */
const MAX_FILE_BYTES = 512 * 1024;

/** Stop scanning after this many bytes read across files. */
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

let locCache = { at: 0, key: '', lines: 0, files: 0 };

/**
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function listTextFiles(root) {
  const { stdout } = await execFileAsync(
    rgExecutable,
    [
      '--files',
      '--no-messages',
      '--glob',
      '!node_modules/**',
      '--glob',
      '!.git/**',
      '--glob',
      '!dist/**',
      '--glob',
      '!build/**',
    ],
    { cwd: root, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, MAX_FILES);
}

/**
 * @param {string} filePath
 * @returns {Promise<number>}
 */
async function countLinesInFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return 0;
  const buf = await fs.readFile(filePath);
  if (!buf.length) return 0;
  let lines = 1;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 10) lines += 1;
  }
  return lines;
}

/**
 * Count lines under the active workspace root.
 * @returns {Promise<{ ok: boolean, lines?: number, files?: number, error?: string }>}
 */
export async function countWorkspaceLoc() {
  const root = getWorkspaceRoot();
  if (!root) {
    return { ok: false, error: 'No workspace configured' };
  }

  const key = root;
  const now = Date.now();
  if (locCache.key === key && now - locCache.at < LOC_CACHE_TTL_MS) {
    return { ok: true, lines: locCache.lines, files: locCache.files };
  }

  let relFiles;
  try {
    relFiles = await listTextFiles(root);
  } catch {
    return { ok: false, error: 'Could not scan workspace files' };
  }

  let lines = 0;
  let files = 0;
  let bytesRead = 0;

  for (const rel of relFiles) {
    const abs = path.join(root, rel);
    if (!abs.startsWith(root)) continue;
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      bytesRead += stat.size;
      if (bytesRead > MAX_TOTAL_BYTES) break;
      lines += await countLinesInFile(abs);
      files += 1;
    } catch {
      /* skip unreadable paths */
    }
  }

  locCache = { at: now, key, lines, files };
  return { ok: true, lines, files };
}

/** @param {unknown} _reason */
export function clearWorkspaceLocCache(_reason) {
  locCache = { at: 0, key: '', lines: 0, files: 0 };
}
