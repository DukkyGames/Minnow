/**
 * Serve process log tail — reads ~/.minnow/logs/models/{runId}.log.
 *
 * llama-server writes through the shared terminal runner, so the log file is the
 * one source that survives a Minnow restart. Streaming polls file size and emits
 * the delta, which works for both in-memory and recovered runs.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { modelsLogDir } from './paths.js';

const POLL_MS = 900;
const DEFAULT_TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 512 * 1024;

/**
 * @param {string} runId
 */
function logPathForRun(runId) {
  return path.join(modelsLogDir(), `${runId}.log`);
}

/**
 * Read the trailing bytes of a serve log.
 * @param {string} runId
 * @param {number} [maxBytes]
 * @returns {Promise<{ text: string, size: number } | null>}
 */
export async function readServeLogTail(runId, maxBytes = DEFAULT_TAIL_BYTES) {
  const bytes = Math.min(Math.max(1024, maxBytes), MAX_TAIL_BYTES);
  const logPath = logPathForRun(runId);
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
 * Read bytes appended since a known offset.
 * @param {string} runId
 * @param {number} offset
 * @returns {Promise<{ text: string, size: number } | null>}
 */
async function readServeLogSince(runId, offset) {
  const logPath = logPathForRun(runId);
  let handle;
  try {
    const stat = await fsp.stat(logPath);
    // Truncated or rotated behind us — restart from the tail.
    if (stat.size < offset) return readServeLogTail(runId);
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
 * Follow a serve log, emitting the existing tail then appended chunks.
 * @param {string} runId
 * @param {(event: { text: string, offset: number, initial?: boolean }) => void} onChunk
 * @returns {() => void} unsubscribe
 */
export function subscribeServeLog(runId, onChunk) {
  let offset = 0;
  let stopped = false;
  let timer = null;

  const tick = async () => {
    if (stopped) return;
    const chunk = await readServeLogSince(runId, offset);
    if (!stopped && chunk) {
      offset = chunk.size;
      if (chunk.text) onChunk({ text: chunk.text, offset });
    }
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  };

  void (async () => {
    const tail = await readServeLogTail(runId);
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
