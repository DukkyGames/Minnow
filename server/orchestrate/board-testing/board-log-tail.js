/**
 * Bounded, MINNOW_HOME-scoped board log tailing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../../config/home.js';
import { sanitizeGroupId } from './board-log-validate.js';
import { sanitizeDiagnosticValue } from './sanitize.js';

const MAX_TAIL_BYTES = 512_000;
const MAX_EVENTS = 500;

/** @param {string} groupId */
export function resolveSafeBoardLogPath(groupId) {
  const trimmed = typeof groupId === 'string' ? groupId.trim() : '';
  const safe = sanitizeGroupId(trimmed);
  if (
    !safe ||
    safe !== trimmed ||
    safe === '.' ||
    safe === '..' ||
    trimmed.length > 200
  ) {
    throw new Error('groupId must be a safe board identifier, not a path');
  }
  const root = path.resolve(getMinnowHome(), 'logs', 'orchestrate');
  const target = path.resolve(root, `${safe}.jsonl`);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error('board log path escapes MINNOW_HOME');
  }
  return { root, target };
}

/**
 * @param {{ groupId: string; limit?: number }} options
 */
export async function tailBoardLog(options) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENTS) {
    throw new Error(`limit must be an integer between 1 and ${MAX_EVENTS}`);
  }
  const { root, target } = resolveSafeBoardLogPath(options.groupId);
  let handle;
  try {
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
    if (!realTarget.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error('board log symlink escapes MINNOW_HOME');
    }
    handle = await fs.open(realTarget, 'r');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      throw new Error('board log not found');
    }
    throw err;
  }

  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - MAX_TAIL_BYTES);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline < 0 ? '' : text.slice(firstNewline + 1);
    }
    const lines = text.split('\n').filter((line) => line.trim());
    const selected = lines.slice(-limit);
    const events = [];
    let malformedLines = 0;
    for (const line of selected) {
      try {
        events.push(sanitizeDiagnosticValue(JSON.parse(line)));
      } catch {
        malformedLines += 1;
      }
    }
    return {
      ok: true,
      groupId: options.groupId.trim(),
      events,
      malformedLines,
      truncated: start > 0 || lines.length > limit,
    };
  } finally {
    await handle.close();
  }
}
