/**
 * Durable index of agent shell runs (~/.minnow/runs/shell/<runId>.json).
 *
 * terminal-runner keeps runs in an in-memory Map that is evicted 60s after a run
 * finishes and is lost entirely when the server process restarts. Detached
 * background children outlive both, so without an on-disk mirror the harness
 * loses track of them: list_running_commands goes empty, read_command_log cannot
 * find the log (it guessed logs/terminal/ regardless of the run's logSubdir) and
 * exitCode reads back as null forever. This module is that mirror.
 *
 * Every write is best-effort: index failures must never break a running command.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Finished entries older than this are pruned. */
const INDEX_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Re-prune after this many recorded runs so a long-lived host stays bounded. */
const PRUNE_EVERY_WRITES = 200;

/** Index directory. */
function runIndexDir() {
  return path.join(getMinnowHome(), 'runs', 'shell');
}

/** Sanitize a runId for use as a file name. */
function safeId(runId) {
  return String(runId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Absolute path of one index entry. */
function runIndexPath(runId) {
  return path.join(runIndexDir(), `${safeId(runId)}.json`);
}

/** @type {Map<string, Promise<unknown>>} Serializes read-modify-write per runId. */
const writeQueues = new Map();

/**
 * Queue a mutation for one runId so concurrent spawn/finish writes cannot interleave.
 * @template T
 * @param {string} runId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | null>}
 */
function enqueue(runId, fn) {
  const prev = writeQueues.get(runId) ?? Promise.resolve();
  const next = prev.then(fn).catch(() => null).finally(() => {
    if (writeQueues.get(runId) === next) writeQueues.delete(runId);
  });
  writeQueues.set(runId, next);
  return /** @type {Promise<T | null>} */ (next);
}

/** Atomic JSON write (temp file + rename in the same directory). */
async function atomicWriteJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * Is a pid still running?
 *
 * EPERM means the process exists but belongs to another user, which still counts
 * as alive. Note that pids are recycled, so a true here is evidence and not proof
 * for a run recorded by an earlier host process — callers flag those as orphaned
 * rather than acting on them destructively.
 * @param {number | null | undefined} pid
 */
export function isPidAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}

/**
 * @typedef {object} RunIndexEntry
 * @property {string} runId
 * @property {string} command
 * @property {string} cwd
 * @property {'user' | 'agent'} source
 * @property {string} [chatId]
 * @property {string} [toolCallId]
 * @property {number | null} pid
 * @property {number} hostPid pid of the server process that started the run
 * @property {boolean} background
 * @property {string} logPath absolute log path
 * @property {string} logRelPath path relative to ~/.minnow
 * @property {number} startedAt
 * @property {number | null} finishedAt
 * @property {number | null} exitCode
 * @property {boolean} timedOut
 * @property {boolean} stopped
 * @property {boolean} finished
 * @property {boolean} [truncated] output exceeded the in-memory buffer cap
 * @property {string} [endedReason]
 * @property {boolean} [orphaned] started by a previous host process, child still alive
 */

/**
 * Record a newly spawned run.
 * @param {Partial<RunIndexEntry> & { runId: string }} entry
 */
export function recordRunStart(entry) {
  const record = {
    source: 'agent',
    pid: null,
    background: false,
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    timedOut: false,
    stopped: false,
    finished: false,
    ...entry,
    hostPid: process.pid,
  };
  maybeSchedulePrune();
  return enqueue(entry.runId, async () => {
    await atomicWriteJson(runIndexPath(entry.runId), record);
    return record;
  });
}

/** Runs recorded since the last prune pass. */
let writesSincePrune = 0;

/**
 * A long-lived host keeps adding entries after the startup reconcile, so re-prune
 * periodically to stop the directory growing without bound.
 */
function maybeSchedulePrune() {
  writesSincePrune += 1;
  if (writesSincePrune < PRUNE_EVERY_WRITES) return;
  writesSincePrune = 0;
  void runReconcile().catch(() => {});
}

/**
 * Merge a patch into an existing entry. No-op when the entry is missing.
 * @param {string} runId
 * @param {Partial<RunIndexEntry>} patch
 */
export function updateRunIndexEntry(runId, patch) {
  return enqueue(runId, async () => {
    const current = await readEntryRaw(runId);
    if (!current) return null;
    const merged = { ...current, ...patch };
    await atomicWriteJson(runIndexPath(runId), merged);
    return merged;
  });
}

/** Read one entry without waiting on the write queue. */
async function readEntryRaw(runId) {
  try {
    const raw = await fs.readFile(runIndexPath(runId), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} runId
 * @returns {Promise<RunIndexEntry | null>}
 */
export async function readRunIndexEntry(runId) {
  if (!runId) return null;
  await reconcileRunIndex();
  const pending = writeQueues.get(runId);
  if (pending) await pending;
  return readEntryRaw(runId);
}

/**
 * Unfinished runs inherited from an earlier host process, keyed by runId.
 * Populated by the reconcile pass so the common case (no orphans) costs nothing
 * on the list_running_commands path.
 * @type {Map<string, RunIndexEntry>}
 */
const orphanedRuns = new Map();

/**
 * Runs left behind by an earlier host process whose child is still alive.
 * @returns {Promise<RunIndexEntry[]>}
 */
export async function listOrphanedRuns() {
  await reconcileRunIndex();
  const live = [];
  for (const [runId, entry] of orphanedRuns) {
    if (!isPidAlive(entry.pid)) {
      orphanedRuns.delete(runId);
      void updateRunIndexEntry(runId, {
        finished: true,
        orphaned: false,
        finishedAt: Date.now(),
        endedReason: 'exited_after_host_restart',
      });
      continue;
    }
    live.push(entry);
  }
  return live;
}

/** @type {Promise<void> | null} */
let reconcilePromise = null;

/**
 * One-time-per-process pass over the index: settle runs stranded by a host
 * restart and prune entries that finished long ago.
 */
function reconcileRunIndex() {
  if (!reconcilePromise) {
    reconcilePromise = runReconcile().catch(() => {});
  }
  return reconcilePromise;
}

/** Tests only: allow reconcile to run again against a fresh home. */
export function resetRunIndexReconcileForTests() {
  reconcilePromise = null;
  orphanedRuns.clear();
  writesSincePrune = 0;
}

async function runReconcile() {
  let files = [];
  try {
    files = await fs.readdir(runIndexDir());
  } catch {
    return;
  }

  const now = Date.now();
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const runId = file.slice(0, -'.json'.length);
    const entry = await readEntryRaw(runId);
    if (!entry?.runId) {
      await fs.rm(path.join(runIndexDir(), file), { force: true }).catch(() => {});
      continue;
    }

    if (entry.finished) {
      const endedAt = entry.finishedAt ?? entry.startedAt ?? 0;
      if (now - endedAt > INDEX_RETENTION_MS) {
        await fs.rm(runIndexPath(runId), { force: true }).catch(() => {});
      }
      continue;
    }

    // Unfinished rows owned by this process are live in terminal-runner's map.
    if (entry.hostPid === process.pid) continue;

    if (isPidAlive(entry.pid)) {
      const orphan = { ...entry, orphaned: true };
      orphanedRuns.set(runId, orphan);
      if (!entry.orphaned) await atomicWriteJson(runIndexPath(runId), orphan);
      continue;
    }

    // The host died and the child is gone: nobody will ever write an exit code.
    orphanedRuns.delete(runId);
    await atomicWriteJson(runIndexPath(runId), {
      ...entry,
      finished: true,
      orphaned: false,
      finishedAt: entry.finishedAt ?? now,
      endedReason: 'host_restart',
    });
  }
}
