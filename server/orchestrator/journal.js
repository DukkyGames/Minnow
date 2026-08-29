/**
 * P1-A — the journal store. Append-only JSONL with atomic snapshots.
 *
 * The journal *is* the state. If a torn write can corrupt it, replay is not a
 * recovery mechanism — it is a second failure mode. So this module has exactly
 * two jobs: never let an invalid or half-written event become readable, and
 * never let a snapshot become authoritative.
 *
 * Layout, under `getMinnowHome()`:
 *
 * ```
 * boards/<boardId>/journal.jsonl     append-only, kept forever
 * boards/<boardId>/snapshot.json     a cache; safe to delete at any time
 * ```
 *
 * ## Journals are never pruned
 *
 * There is no prune path here and none should be added. PRD §11 needs the raw
 * history to retroactively measure how many abandonments a smarter policy would
 * have saved, and that is only possible while the history exists.
 */

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { getMinnowHome, ensureMinnowLayout } from '../config/home.js';
import { derive } from './core/derive.js';
import { validateEvent } from './core/events.js';
import {
  deriveFrom,
  isSnapshotUsable,
  makeSnapshot,
  SNAPSHOT_INTERVAL,
  shouldSnapshot,
} from './core/snapshot.js';

/** @returns {string} */
function boardsRoot() {
  return path.join(getMinnowHome(), 'boards');
}

/**
 * @param {string} boardId
 * @returns {string}
 */
export function boardDir(boardId) {
  return path.join(boardsRoot(), safeBoardId(boardId));
}

/**
 * @param {string} boardId
 * @returns {string}
 */
export function journalPath(boardId) {
  return path.join(boardDir(boardId), 'journal.jsonl');
}

/**
 * @param {string} boardId
 * @returns {string}
 */
export function snapshotPath(boardId) {
  return path.join(boardDir(boardId), 'snapshot.json');
}

/**
 * Board ids reach here from HTTP, so they are never interpolated into a path
 * unchecked.
 *
 * @param {string} boardId
 * @returns {string}
 */
function safeBoardId(boardId) {
  const id = String(boardId ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) {
    throw new Error(`invalid board id: ${JSON.stringify(boardId)}`);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Append serialisation
// ---------------------------------------------------------------------------

/**
 * One promise chain per board.
 *
 * `seq` is assigned inside the chain, so two concurrent `appendEvent` calls for
 * one board queue rather than racing. Relying on `fs.appendFile` being atomic
 * would order the *bytes* but not the numbering, and two events could take the
 * same `seq` — which silently breaks the snapshot anchor and every `Last-Event-ID`
 * resume.
 *
 * @type {Map<string, Promise<unknown>>}
 */
const appendChains = new Map();

/**
 * Highest `seq` written so far, per board. A cache of the journal's tail, not a
 * source: it is seeded from the file on first use and only ever advances.
 *
 * @type {Map<string, number>}
 */
const highestSeq = new Map();

/**
 * Run `task` after every append already queued for this board.
 *
 * @template T
 * @param {string} boardId
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function serialise(boardId, task) {
  const previous = appendChains.get(boardId) ?? Promise.resolve();
  // The chain must not break on a rejection, or one bad append wedges the board.
  const next = previous.then(task, task);
  appendChains.set(
    boardId,
    next.catch(() => {}),
  );
  return next;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Read a board's journal.
 *
 * A **trailing** partial line is dropped silently: a crash mid-append leaves
 * one, and that is the normal, expected shape of an interrupted journal.
 *
 * A partial line anywhere **else** throws. That cannot be produced by a crash —
 * appends are ordered and only the last one can be incomplete — so it means
 * something other than a crash touched the file, and silently skipping it would
 * hide real corruption behind a plausible-looking board.
 *
 * @param {string} boardId
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function readEvents(boardId) {
  const file = journalPath(boardId);
  /** @type {Record<string, unknown>[]} */
  const events = [];

  /** @type {string | null} */
  let pendingBadLine = null;
  /** @type {number} */
  let pendingBadLineNumber = 0;
  let lineNumber = 0;

  let stream;
  try {
    stream = createReadStream(file, { encoding: 'utf8' });
    await new Promise((resolve, reject) => {
      stream.once('open', resolve);
      stream.once('error', reject);
    });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }

  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (line.trim().length === 0) continue;

      // A bad line seen earlier was not the last one after all.
      if (pendingBadLine !== null) {
        throw new Error(
          `journal ${file} is corrupt at line ${pendingBadLineNumber}: ` +
            'unparseable line followed by further events',
        );
      }

      try {
        events.push(JSON.parse(line));
      } catch {
        pendingBadLine = line;
        pendingBadLineNumber = lineNumber;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return events;
}

/**
 * The last `seq` on disk, or 0.
 *
 * @param {string} boardId
 * @returns {Promise<number>}
 */
async function readHighestSeq(boardId) {
  const events = await readEvents(boardId);
  let highest = 0;
  for (const event of events) {
    const seq = Number(event?.seq);
    if (Number.isSafeInteger(seq) && seq > highest) highest = seq;
  }
  return highest;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Append one event, assigning its `seq` and stamping `ts`.
 *
 * Validation happens *before* the write, so an invalid event never reaches disk.
 * `ts` is stamped here and nowhere else, and is display-only — nothing in the
 * fold may read it.
 *
 * @param {string} boardId
 * @param {Record<string, unknown>} event
 * @param {{ now?: () => number }} [options]  injectable clock, for tests
 * @returns {Promise<Record<string, unknown>>} the stamped event
 */
export function appendEvent(boardId, event, options = {}) {
  /** @type {string} */
  let id;
  try {
    id = safeBoardId(boardId);
  } catch (err) {
    // Every other failure here rejects, so this one does too. A function that
    // sometimes throws synchronously and sometimes rejects makes `.catch()`
    // chains in the engine silently incomplete.
    return Promise.reject(err);
  }
  const now = options.now ?? (() => Date.now());

  return serialise(id, async () => {
    if (!highestSeq.has(id)) highestSeq.set(id, await readHighestSeq(id));
    const seq = /** @type {number} */ (highestSeq.get(id)) + 1;

    const stamped = { v: 1, ...event, seq, ts: now() };
    const checked = validateEvent(stamped);
    if (!checked.ok) {
      throw new Error(`refusing to journal an invalid event: ${checked.error}`);
    }

    await fs.mkdir(boardDir(id), { recursive: true });
    await fs.appendFile(journalPath(id), `${JSON.stringify(stamped)}\n`, 'utf8');
    highestSeq.set(id, seq);

    // Fire and forget. A snapshot is a cache, so failing to write one must never
    // fail the append that triggered it — the journal is already durable.
    if (shouldSnapshot(seq)) {
      void refreshSnapshot(id).catch((err) => {
        console.warn(`[orchestrator] snapshot write failed for ${id}:`, err?.message ?? err);
      });
    }

    return stamped;
  });
}

/**
 * Append several events as one unit, so nothing can interleave between them.
 *
 * The engine uses this when a single decision implies more than one completed
 * effect — an abandonment and the skips it strands, say — because a reader that
 * saw only half of that would derive a board mid-decision.
 *
 * @param {string} boardId
 * @param {Record<string, unknown>[]} events
 * @param {{ now?: () => number }} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export function appendEvents(boardId, events, options = {}) {
  /** @type {string} */
  let id;
  try {
    id = safeBoardId(boardId);
  } catch (err) {
    return Promise.reject(err);
  }
  const now = options.now ?? (() => Date.now());

  return serialise(id, async () => {
    if (!highestSeq.has(id)) highestSeq.set(id, await readHighestSeq(id));
    let seq = /** @type {number} */ (highestSeq.get(id));

    /** @type {Record<string, unknown>[]} */
    const stampedAll = [];
    for (const event of events) {
      seq += 1;
      const stamped = { v: 1, ...event, seq, ts: now() };
      const checked = validateEvent(stamped);
      if (!checked.ok) {
        throw new Error(`refusing to journal an invalid event: ${checked.error}`);
      }
      stampedAll.push(stamped);
    }
    if (stampedAll.length === 0) return [];

    await fs.mkdir(boardDir(id), { recursive: true });
    await fs.appendFile(
      journalPath(id),
      `${stampedAll.map((e) => JSON.stringify(e)).join('\n')}\n`,
      'utf8',
    );
    highestSeq.set(id, seq);

    if (stampedAll.some((e) => shouldSnapshot(Number(e.seq)))) {
      void refreshSnapshot(id).catch((err) => {
        console.warn(`[orchestrator] snapshot write failed for ${id}:`, err?.message ?? err);
      });
    }

    return stampedAll;
  });
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * Write a snapshot, temp-then-rename so a reader never sees a partial one.
 *
 * @param {string} boardId
 * @param {import('./core/types').Snapshot} snapshot
 * @returns {Promise<void>}
 */
export async function writeSnapshot(boardId, snapshot) {
  const id = safeBoardId(boardId);
  const target = snapshotPath(id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(snapshot)}\n`, 'utf8');
  await fs.rename(tmp, target);
}

/**
 * Read the snapshot, or null when there isn't one or it is unreadable.
 *
 * Unreadable is not an error: a snapshot is a cache, and the caller's answer to
 * a missing one and a corrupt one is the same — fold the journal.
 *
 * @param {string} boardId
 * @returns {Promise<import('./core/types').Snapshot | null>}
 */
export async function readSnapshot(boardId) {
  try {
    const raw = await fs.readFile(snapshotPath(boardId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Recompute and write the snapshot from the journal as it now stands.
 *
 * @param {string} boardId
 * @returns {Promise<void>}
 */
export async function refreshSnapshot(boardId) {
  const events = await readEvents(boardId);
  if (events.length === 0) return;
  const through = events.reduce((max, e) => {
    const seq = Number(e?.seq);
    return Number.isSafeInteger(seq) && seq > max ? seq : max;
  }, 0);
  if (through === 0) return;
  await writeSnapshot(boardId, makeSnapshot(boardId, derive(events), through));
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * The board's current state.
 *
 * Always equal to `derive(readEvents(boardId))`. The snapshot only ever changes
 * how long that takes: when it is unusable for any reason, this falls through to
 * the full fold rather than repairing anything.
 *
 * @param {string} boardId
 * @returns {Promise<import('./core/types').BoardState>}
 */
export async function loadState(boardId) {
  const events = await readEvents(boardId);
  const snapshot = await readSnapshot(boardId);
  if (!snapshot || !isSnapshotUsable(snapshot, events)) return derive(events);
  return deriveFrom(snapshot, events);
}

// ---------------------------------------------------------------------------
// Directory management
// ---------------------------------------------------------------------------

/**
 * Create a board's directory and an empty journal.
 *
 * @param {string} boardId
 * @returns {Promise<void>}
 */
export async function createBoard(boardId) {
  const id = safeBoardId(boardId);
  await ensureMinnowLayout();
  await fs.mkdir(boardDir(id), { recursive: true });
  const file = journalPath(id);
  try {
    // Exclusive: creating a board that already exists must not truncate its
    // journal.
    const handle = await fs.open(file, 'wx');
    await handle.close();
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
  }
}

/**
 * @param {string} boardId
 * @returns {Promise<boolean>}
 */
export async function boardExists(boardId) {
  try {
    await fs.access(journalPath(boardId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Every board with a journal on disk.
 *
 * @returns {Promise<string[]>} sorted, so listings are stable
 */
export async function listBoards() {
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await fs.readdir(boardsRoot(), { withFileTypes: true });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }
  /** @type {string[]} */
  const boards = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await boardExists(entry.name)) boards.push(entry.name);
  }
  return boards.sort();
}

/**
 * Drop the per-process caches. For tests that move `MINNOW_HOME` between cases;
 * nothing in production needs it, because the caches only ever grow forward.
 *
 * @returns {void}
 */
export function resetJournalCache() {
  appendChains.clear();
  highestSeq.clear();
}

export { SNAPSHOT_INTERVAL };
