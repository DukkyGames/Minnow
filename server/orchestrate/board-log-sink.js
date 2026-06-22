/**
 * Durable JSONL mirror for orchestrate board diagnostic events (~/.minnow/logs/orchestrate/).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

const LOG_DIR = path.join(getMinnowHome(), 'logs', 'orchestrate');
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sanitizeGroupId(groupId) {
  const trimmed = typeof groupId === 'string' ? groupId.trim() : '';
  if (!trimmed) return null;
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return safe || null;
}

function logFilePath(groupId) {
  const safe = sanitizeGroupId(groupId);
  if (!safe) return null;
  return path.join(LOG_DIR, `${safe}.jsonl`);
}

async function ensureLogDir() {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

async function rotateIfNeeded(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size < MAX_FILE_BYTES) return;
    const rotated = `${filePath}.${Date.now()}.bak`;
    await fs.rename(filePath, rotated);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
  }
}

/** Remove rotated JSONL files older than {@link PRUNE_AGE_MS}. Best-effort at boot. */
export async function pruneBoardLogFiles() {
  try {
    await ensureLogDir();
    const now = Date.now();
    const entries = await fs.readdir(LOG_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.bak')) continue;
      const full = path.join(LOG_DIR, entry.name);
      const stat = await fs.stat(full);
      if (now - stat.mtimeMs > PRUNE_AGE_MS) {
        await fs.unlink(full).catch(() => {});
      }
    }
  } catch {
    /* pruning is best-effort */
  }
}

/**
 * Append one board log event as a JSON line. Never throws to callers.
 * @param {string} groupId
 * @param {Record<string, unknown>} event
 */
export async function appendBoardLogLine(groupId, event) {
  const filePath = logFilePath(groupId);
  if (!filePath || !event || typeof event !== 'object') return;
  await ensureLogDir();
  await rotateIfNeeded(filePath);
  const line = `${JSON.stringify(event)}\n`;
  await fs.appendFile(filePath, line, 'utf8');
}
