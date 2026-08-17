/**
 * Serve process log tail — reads spawn logs under ~/.minnow/logs/models/{runId}.log
 * and, for MLX, the shared managed mlx-lm log under ~/.minnow/logs/servers/.
 *
 * llama-server writes through the shared terminal runner, so the log file is the
 * one source that survives a Minnow restart. Streaming polls file size and emits
 * the delta, which works for both in-memory and recovered runs.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { getServerLogPath } from '../servers/paths.js';
import { modelsLogDir } from './paths.js';

const POLL_MS = 900;
const DEFAULT_TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 512 * 1024;

/** Managed server id whose stdout/stderr feed MLX model loads. */
export const MLX_LM_MANAGED_SERVER_ID = 'mlx-lm';

/**
 * Absolute spawn log for a llama.cpp run (`~/.minnow/logs/models/{runId}.log`).
 * @param {string} runId
 */
export function logPathForRun(runId) {
  return path.join(modelsLogDir(), `${runId}.log`);
}

/**
 * Append a line to a serve spawn log. Creates the file when createRun has not yet
 * written one (tests) so Phase 3 can grep `fit planner` after a manual over-budget load.
 * @param {string} runId
 * @param {string} line
 */
export async function appendServeLog(runId, line) {
  if (!runId || typeof runId !== 'string' || !line) return;
  const logPath = logPathForRun(runId);
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  const text = line.endsWith('\n') ? line : `${line}\n`;
  await fsp.appendFile(logPath, text, 'utf8');
}

/**
 * Absolute log file for a serve row — spawn logs for llama-cpp, managed server
 * logs for mlx-lm (one shared process, no per-serve runId).
 * @param {{ runId?: string | null, runtime?: string } | null | undefined} serve
 * @returns {string | null}
 */
export function resolveServeLogPath(serve) {
  if (serve?.runId) return logPathForRun(serve.runId);
  if (serve?.runtime === 'mlx-lm') return getServerLogPath(MLX_LM_MANAGED_SERVER_ID);
  return null;
}

/**
 * @param {string} logPath
 * @param {number} [maxBytes]
 * @returns {Promise<{ text: string, size: number } | null>}
 */
async function readLogFileTail(logPath, maxBytes = DEFAULT_TAIL_BYTES) {
  const bytes = Math.min(Math.max(1024, maxBytes), MAX_TAIL_BYTES);
  let handle;
  try {
    const stat = await fsp.stat(logPath);
    const start = Math.max(0, stat.size - bytes);
    handle = await fsp.open(logPath, 'r');
    const buf = Buffer.alloc(stat.size - start);
    await handle.read(buf, 0, buf.length, start);
    return { text: buf.toString('utf8'), size: stat.size };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * @param {string} logPath
 * @param {number} offset
 * @returns {Promise<{ text: string, size: number } | null>}
 */
async function readLogFileSince(logPath, offset) {
  let handle;
  try {
    const stat = await fsp.stat(logPath);
    // Truncated or rotated behind us — restart from the tail.
    if (stat.size < offset) return readLogFileTail(logPath);
    if (stat.size === offset) return { text: '', size: stat.size };
    handle = await fsp.open(logPath, 'r');
    const buf = Buffer.alloc(Math.min(stat.size - offset, MAX_TAIL_BYTES));
    await handle.read(buf, 0, buf.length, offset);
    return { text: buf.toString('utf8'), size: stat.size };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Read the trailing bytes of a serve log.
 * @param {string} runId
 * @param {number} [maxBytes]
 * @returns {Promise<{ text: string, size: number } | null>}
 */
export async function readServeLogTail(runId, maxBytes = DEFAULT_TAIL_BYTES) {
  return readLogFileTail(logPathForRun(runId), maxBytes);
}

/**
 * Read the trailing bytes of whichever log backs a serve row.
 * @param {{ runId?: string | null, runtime?: string }} serve
 * @param {number} [maxBytes]
 */
export async function readServeLogTailForServe(serve, maxBytes = DEFAULT_TAIL_BYTES) {
  const logPath = resolveServeLogPath(serve);
  if (!logPath) return null;
  return readLogFileTail(logPath, maxBytes);
}

/**
 * Read bytes appended since a known offset.
 * @param {string} runId
 * @param {number} offset
 * @returns {Promise<{ text: string, size: number } | null>}
 */
async function readServeLogSince(runId, offset) {
  return readLogFileSince(logPathForRun(runId), offset);
}

/**
 * Follow a log file at a fixed path, emitting the existing tail then appended chunks.
 * @param {string} logPath
 * @param {(event: { text: string, offset: number, initial?: boolean }) => void} onChunk
 * @returns {() => void} unsubscribe
 */
function subscribeLogFile(logPath, onChunk) {
  let offset = 0;
  let stopped = false;
  let timer = null;

  const tick = async () => {
    if (stopped) return;
    const chunk = await readLogFileSince(logPath, offset);
    if (!stopped && chunk) {
      offset = chunk.size;
      if (chunk.text) onChunk({ text: chunk.text, offset });
    }
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  };

  void (async () => {
    const tail = await readLogFileTail(logPath);
    if (stopped) return;
    offset = tail?.size ?? 0;
    onChunk({ text: tail?.text ?? '', offset, initial: true });
    timer = setTimeout(tick, POLL_MS);
  })();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * Follow a serve log, emitting the existing tail then appended chunks.
 * @param {string} runId
 * @param {(event: { text: string, offset: number, initial?: boolean }) => void} onChunk
 * @returns {() => void} unsubscribe
 */
export function subscribeServeLog(runId, onChunk) {
  return subscribeLogFile(logPathForRun(runId), onChunk);
}

/**
 * Follow whichever log backs a serve row (spawn log or shared mlx-lm server log).
 * @param {{ runId?: string | null, runtime?: string }} serve
 * @param {(event: { text: string, offset: number, initial?: boolean }) => void} onChunk
 * @returns {() => void} unsubscribe — no-op when the serve has no log source
 */
export function subscribeServeLogForServe(serve, onChunk) {
  const logPath = resolveServeLogPath(serve);
  if (!logPath) return () => {};
  return subscribeLogFile(logPath, onChunk);
}
