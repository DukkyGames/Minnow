/**
 * Disk checkpoints for backend-owned generations.
 *
 * The generation store is a plain in-memory Map, so a server restart mid-stream
 * used to lose the reply outright — the client came back, found no state, and got
 * "This reply was lost when the server restarted." Persisted generations now append
 * their raw SSE bytes to `~/.minnow/generations/<id>.sse` with an `<id>.json` sidecar,
 * so the same stream can be replayed byte-for-byte from disk afterwards.
 *
 * Writes are throttled (time or size) — never one fsync per chunk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Flush no more often than this, however fast chunks arrive. */
const FLUSH_INTERVAL_MS = 250;

/** …unless this much is already queued, which forces an immediate flush. */
const FLUSH_BYTES = 64 * 1024;

/** Checkpoints older than this are swept on boot. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Total on-disk cap; oldest checkpoints are dropped first past this. */
const MAX_DIR_BYTES = 256 * 1024 * 1024;

/** Sidecar `status: streaming` after a restart means the process died mid-stream. */
export const INTERRUPTED_BY_RESTART_MESSAGE =
  'Reply interrupted when the server restarted.';

/**
 * @typedef {object} CheckpointWriter
 * @property {Buffer[]} pending
 * @property {number} pendingBytes
 * @property {ReturnType<typeof setTimeout> | null} timer
 * @property {boolean} broken a write failed; stop trying for this generation
 */

/** @type {Map<string, CheckpointWriter>} */
const writers = new Map();

/** Only a valid UUID may become a path segment. */
const ID_RE = /^[0-9a-fA-F-]{36}$/;

function checkpointDir() {
  return path.join(getMinnowHome(), 'generations');
}

function ssePath(id) {
  return path.join(checkpointDir(), `${id}.sse`);
}

function metaPath(id) {
  return path.join(checkpointDir(), `${id}.json`);
}

function isCheckpointableId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/** True when this generation is worth checkpointing (main chat / resumable turns). */
function shouldCheckpoint(state) {
  return Boolean(state?.persist) && isCheckpointableId(state?.id);
}

function ensureDir() {
  try {
    fs.mkdirSync(checkpointDir(), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {import('./store.js').GenerationState} state
 * @returns {object}
 */
function sidecarPayload(state) {
  return {
    id: state.id,
    status: state.status,
    providerId: state.providerId,
    chatId: state.chatId ?? null,
    chosenProviderId: state.chosenProviderId ?? null,
    chosenModelId: state.chosenModelId ?? null,
    fallbackUsed: state.fallbackUsed === true,
    errorMessage: state.errorMessage ?? null,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt ?? null,
  };
}

function writeSidecar(state) {
  if (!ensureDir()) return;
  try {
    fs.writeFileSync(
      metaPath(state.id),
      `${JSON.stringify(sidecarPayload(state), null, 2)}\n`,
      'utf8',
    );
  } catch {
    /* checkpointing is best-effort; a failed write must never fail the stream */
  }
}

/**
 * @param {string} id
 * @returns {CheckpointWriter}
 */
function getWriter(id) {
  let w = writers.get(id);
  if (!w) {
    w = { pending: [], pendingBytes: 0, timer: null, broken: false };
    writers.set(id, w);
  }
  return w;
}

/**
 * Append queued bytes in one write. Synchronous on purpose: the throttle keeps this
 * to a handful of calls per second, and a serialized append is far simpler to reason
 * about than interleaved async writes to the same file.
 *
 * @param {string} id
 */
function flushWriter(id) {
  const w = writers.get(id);
  if (!w) return;
  if (w.timer) {
    clearTimeout(w.timer);
    w.timer = null;
  }
  if (w.pending.length === 0 || w.broken) return;
  const buf = Buffer.concat(w.pending, w.pendingBytes);
  w.pending = [];
  w.pendingBytes = 0;
  if (!ensureDir()) {
    w.broken = true;
    return;
  }
  try {
    fs.appendFileSync(ssePath(id), buf);
  } catch {
    w.broken = true;
  }
}

/** Record the generation before any bytes arrive, so a crash still leaves a sidecar. */
export function checkpointCreated(state) {
  if (!shouldCheckpoint(state)) return;
  writeSidecar(state);
}

/**
 * Queue one SSE chunk. Flushes on {@link FLUSH_BYTES} immediately, otherwise after
 * {@link FLUSH_INTERVAL_MS}.
 *
 * @param {import('./store.js').GenerationState} state
 * @param {Buffer} buf
 */
export function checkpointAppend(state, buf) {
  if (!shouldCheckpoint(state) || !buf?.length) return;
  const w = getWriter(state.id);
  if (w.broken) return;
  w.pending.push(buf);
  w.pendingBytes += buf.length;
  if (w.pendingBytes >= FLUSH_BYTES) {
    flushWriter(state.id);
    return;
  }
  if (!w.timer) {
    w.timer = setTimeout(() => flushWriter(state.id), FLUSH_INTERVAL_MS);
    w.timer.unref?.();
  }
}

/** Flush remaining bytes and stamp the terminal sidecar. */
export function checkpointFinalize(state) {
  if (!shouldCheckpoint(state)) return;
  flushWriter(state.id);
  writers.delete(state.id);
  writeSidecar(state);
}

/** Flush every open writer without touching sidecars (process shutdown). */
export function flushAllCheckpoints() {
  for (const id of [...writers.keys()]) {
    flushWriter(id);
    writers.delete(id);
  }
}

/**
 * @typedef {object} ReadCheckpoint
 * @property {string} id
 * @property {'complete' | 'error' | 'cancelled'} status
 * @property {Buffer} sse
 * @property {object} meta
 */

/**
 * Read one checkpoint back from disk.
 *
 * A sidecar still reading `pending`/`streaming` means the process died mid-stream;
 * it comes back as `error` so the client stops waiting on a stream nothing will
 * finish — the bytes it did produce are replayed first either way.
 *
 * @param {string} id
 * @returns {ReadCheckpoint | null}
 */
export function readCheckpoint(id) {
  if (!isCheckpointableId(id)) return null;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
  } catch {
    return null;
  }
  let sse;
  try {
    sse = fs.readFileSync(ssePath(id));
  } catch {
    sse = Buffer.alloc(0);
  }
  const stored = typeof meta?.status === 'string' ? meta.status : '';
  const interrupted = stored !== 'complete' && stored !== 'error' && stored !== 'cancelled';
  if (sse.length === 0 && interrupted) {
    // Nothing produced and nothing finished — no better than having no checkpoint.
    return null;
  }
  return {
    id,
    status: interrupted ? 'error' : stored,
    sse,
    meta: {
      ...meta,
      errorMessage: interrupted
        ? INTERRUPTED_BY_RESTART_MESSAGE
        : (meta?.errorMessage ?? null),
    },
  };
}

/** Remove both files for one generation. */
export function deleteCheckpoint(id) {
  if (!isCheckpointableId(id)) return;
  for (const file of [ssePath(id), metaPath(id)]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Drop checkpoints older than {@link RETENTION_MS}, then oldest-first until the
 * directory fits {@link MAX_DIR_BYTES}. Cheap enough to run on every boot.
 *
 * @returns {{ removed: number, bytesAfter: number }}
 */
export function sweepCheckpoints() {
  const dir = checkpointDir();
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { removed: 0, bytesAfter: 0 };
  }

  /** @type {Map<string, { mtimeMs: number, bytes: number }>} */
  const byId = new Map();
  for (const name of names) {
    const match = name.match(/^(.+)\.(sse|json)$/);
    if (!match || !isCheckpointableId(match[1])) continue;
    let stat;
    try {
      stat = fs.statSync(path.join(dir, name));
    } catch {
      continue;
    }
    const entry = byId.get(match[1]) ?? { mtimeMs: 0, bytes: 0 };
    entry.mtimeMs = Math.max(entry.mtimeMs, stat.mtimeMs);
    entry.bytes += stat.size;
    byId.set(match[1], entry);
  }

  const now = Date.now();
  let removed = 0;
  let total = 0;
  /** @type {Array<{ id: string, mtimeMs: number, bytes: number }>} */
  const kept = [];
  for (const [id, entry] of byId) {
    if (now - entry.mtimeMs > RETENTION_MS) {
      deleteCheckpoint(id);
      removed += 1;
      continue;
    }
    total += entry.bytes;
    kept.push({ id, ...entry });
  }

  kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const entry of kept) {
    if (total <= MAX_DIR_BYTES) break;
    deleteCheckpoint(entry.id);
    removed += 1;
    total -= entry.bytes;
  }

  return { removed, bytesAfter: total };
}

/** Clear in-process writer state (tests). */
export function resetCheckpointWritersForTests() {
  for (const w of writers.values()) {
    if (w.timer) clearTimeout(w.timer);
  }
  writers.clear();
}
