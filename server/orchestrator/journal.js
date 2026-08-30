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
 * boards/<boardId>/report.md         P3-G end-of-run report; safe to delete (re-run the writer)
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
import { queryAbandonments } from './core/evidence.js';
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
 * Highest `seq` written so far, per board, alongside the file size it was
 * observed at. A cache of the journal's tail, not a source.
 *
 * The size is what keeps it honest. The engine is a board's only writer *by
 * design*, but nothing enforces that, and a second Minnow instance on the same
 * `MINNOW_HOME` would otherwise assign `seq` values that already exist —
 * producing a journal like `1,2,3,2`, which breaks the snapshot anchor and every
 * `Last-Event-ID` resume. If the file is not the size we left it, the cache is
 * stale and the true tail is re-read.
 *
 * @type {Map<string, { seq: number, size: number }>}
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

      // A bad line seen earlier was not the last one after all. Blank lines
      // count: an unparseable line with anything at all after it was written
      // whole, so it is corruption rather than a torn tail.
      if (pendingBadLine !== null) {
        throw new Error(
          `journal ${file} is corrupt at line ${pendingBadLineNumber}: ` +
            'unparseable line followed by further content',
        );
      }

      if (line.trim().length === 0) continue;

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

  // A torn append leaves a final line with no terminating newline. One *with* a
  // newline was written in full, so an unparseable line there is corruption —
  // and silently dropping it would hide real damage behind a plausible board.
  if (pendingBadLine !== null && (await endsWithNewline(file))) {
    throw new Error(
      `journal ${file} is corrupt at line ${pendingBadLineNumber}: ` +
        'unparseable line was written in full',
    );
  }

  return events;
}

/**
 * Give the journal a terminating newline, returning the size it now has.
 *
 * A crash mid-append leaves a final line with no newline after it. `readEvents`
 * already copes — it drops the fragment if it is incomplete and keeps it if the
 * cut happened to land on the closing brace — but leaving the file that way is
 * not harmless: the *next* append concatenates onto the unterminated line. The
 * result is one line that is both unparseable and newline-terminated, which is
 * precisely what real corruption looks like, so from then on `readEvents` and
 * `loadState` throw and `getEngine`, `GET /api/boards/:id` and the SSE stream
 * fail for that board forever. A crash would have bricked the board.
 *
 * The repair is whichever of the two makes the file agree with what `readEvents`
 * already returns for it:
 *
 * - The last line parses — the write reached the end and only the newline was
 *   lost. Terminate it. The event is kept, because a reader already had it.
 * - It does not parse — those bytes were never an event, and no reader ever
 *   returned them. Cut them off.
 *
 * So this is not a prune path: it never removes anything a read would have
 * yielded, and the "journals are never pruned" rule at the top of this file
 * stands.
 *
 * Callers must hold the board's append chain, so no writer can be mid-append.
 *
 * @param {string} boardId
 * @returns {Promise<number>} the file's size afterwards, 0 when there is none
 */
async function repairTornTail(boardId) {
  const file = journalPath(boardId);
  /** @type {import('node:fs/promises').FileHandle | undefined} */
  let handle;
  try {
    handle = await fs.open(file, 'r+');
    const { size } = await handle.stat();
    if (size === 0) return 0;

    const tail = Buffer.alloc(1);
    await handle.read(tail, 0, 1, size - 1);
    if (tail[0] === 0x0a) return size;

    // Walk back to the newline that ends the last complete line. Chunked rather
    // than reading the whole file: journals are kept forever and can be large,
    // while the unterminated line is at most one event long.
    const CHUNK = 64 * 1024;
    let end = size;
    let start = 0;
    while (end > 0) {
      const from = Math.max(0, end - CHUNK);
      const buffer = Buffer.alloc(end - from);
      await handle.read(buffer, 0, buffer.length, from);
      const index = buffer.lastIndexOf(0x0a);
      if (index !== -1) {
        start = from + index + 1;
        break;
      }
      end = from;
    }

    const line = Buffer.alloc(size - start);
    await handle.read(line, 0, line.length, start);
    const text = line.toString('utf8');

    if (text.trim().length > 0 && isJson(text)) {
      await handle.write('\n', size, 'utf8');
      return size + 1;
    }

    await handle.truncate(start);
    return start;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return 0;
    throw err;
  } finally {
    await handle?.close();
  }
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function endsWithNewline(file) {
  /** @type {import('node:fs/promises').FileHandle | undefined} */
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const { size } = await handle.stat();
    if (size === 0) return false;
    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, size - 1);
    return buffer[0] === 0x0a;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/**
 * The last `seq` on disk, or 0.
 *
 * @param {string} boardId
 * @returns {Promise<number>}
 */
export async function readHighestSeq(boardId) {
  const events = await readEvents(boardId);
  let highest = 0;
  for (const event of events) {
    const seq = Number(event?.seq);
    if (Number.isSafeInteger(seq) && seq > highest) highest = seq;
  }
  return highest;
}

/**
 * Current size of a board's journal, or 0 when there is none.
 *
 * @param {string} boardId
 * @returns {Promise<number>}
 */
async function journalSize(boardId) {
  try {
    return (await fs.stat(journalPath(boardId))).size;
  } catch {
    return 0;
  }
}

/**
 * The `seq` the next append should take, revalidating the cache against the file.
 *
 * One `stat` per append, which is nothing next to the write it precedes, and it
 * turns a silent duplicate-`seq` corruption into correct numbering whenever
 * something else has touched the journal.
 *
 * Re-seeding the tail is also where a torn final line is cut off — see
 * {@link repairTornTail}. Only the re-seed path needs it: a cache hit means the
 * file is exactly the size this process left it at, and this process only ever
 * leaves it ending in a newline.
 *
 * @param {string} boardId
 * @returns {Promise<number>}
 */
async function nextSeq(boardId) {
  const size = await journalSize(boardId);
  const cached = highestSeq.get(boardId);
  if (cached && cached.size === size) return cached.seq;
  const repaired = await repairTornTail(boardId);
  const seq = await readHighestSeq(boardId);
  highestSeq.set(boardId, { seq, size: repaired });
  return seq;
}

/**
 * Record where the journal now stands, after a write.
 *
 * @param {string} boardId
 * @param {number} seq
 * @returns {Promise<void>}
 */
async function recordTail(boardId, seq) {
  highestSeq.set(boardId, { seq, size: await journalSize(boardId) });
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
    const seq = (await nextSeq(id)) + 1;

    const stamped = { v: 1, ...event, seq, ts: now() };
    const checked = validateEvent(stamped);
    if (!checked.ok) {
      throw new Error(`refusing to journal an invalid event: ${checked.error}`);
    }

    await fs.mkdir(boardDir(id), { recursive: true });
    await fs.appendFile(journalPath(id), `${JSON.stringify(stamped)}\n`, 'utf8');
    await recordTail(id, seq);

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
    let seq = await nextSeq(id);

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
    await recordTail(id, seq);

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
 * Distinguishes two temp files written inside the same millisecond.
 *
 * `refreshSnapshot` is fire-and-forget, so two of them can overlap. With only
 * pid and clock in the name they collide, which on Windows is an `EPERM` on the
 * rename — silently disabling the memoisation this whole path exists for.
 */
let snapshotWrites = 0;

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
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${(snapshotWrites += 1)}`;
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

/**
 * Abandonments with full attempt history reconstructed from this board's
 * journal alone (MIN-712 / PRD §11). No LLM, no derived cache.
 *
 * @param {string} boardId
 * @returns {Promise<Array<{ taskId: string, reason: unknown, evidence: Record<string, unknown> }>>}
 */
export async function loadAbandonments(boardId) {
  return queryAbandonments(await readEvents(boardId));
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
