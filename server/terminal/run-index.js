import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

const INDEX_RETENTION_MS = 24 * 60 * 60 * 1000;

const PRUNE_EVERY_WRITES = 200;

function runIndexDir() {
  return path.join(getMinnowHome(), 'runs', 'shell');
}

function safeId(runId) {
  return String(runId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function runIndexPath(runId) {
  return path.join(runIndexDir(), `${safeId(runId)}.json`);
}

/** @type {Map<string, Promise<unknown>>} Serializes read-modify-write per runId. */
const writeQueues = new Map();

/**
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

async function atomicWriteJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
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
 * @property {number} hostPid
 * @property {boolean} background
 * @property {string} logPath
 * @property {string} logRelPath
 * @property {number} startedAt
 * @property {number | null} finishedAt
 * @property {number | null} exitCode
 * @property {boolean} timedOut
 * @property {boolean} stopped
 * @property {boolean} finished
 * @property {boolean} [truncated]
 * @property {string} [endedReason]
 * @property {boolean} [orphaned]
 */

/**
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

let writesSincePrune = 0;

function maybeSchedulePrune() {
  writesSincePrune += 1;
  if (writesSincePrune < PRUNE_EVERY_WRITES) return;
  writesSincePrune = 0;
  void runReconcile().catch(() => {});
}

/**
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
 * @type {Map<string, RunIndexEntry>}
 */
const orphanedRuns = new Map();

/**
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

function reconcileRunIndex() {
  if (!reconcilePromise) {
    reconcilePromise = runReconcile().catch(() => {});
  }
  return reconcilePromise;
}

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

    if (entry.hostPid === process.pid) continue;

    if (isPidAlive(entry.pid)) {
      const orphan = { ...entry, orphaned: true };
      orphanedRuns.set(runId, orphan);
      if (!entry.orphaned) await atomicWriteJson(runIndexPath(runId), orphan);
      continue;
    }

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
