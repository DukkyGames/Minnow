/**
 * P9-D — per-attempt transcripts.
 *
 * A finished task carries a one-line `summary`, and the first thing anyone asks
 * when a task fails is "what did it actually do". That answer is the turn's
 * event stream, and it does **not** belong on the journal: P2-F already keeps
 * tokens off it because a six-hour run would make replay and storage unbounded,
 * and the same argument applies to every tool call inside it.
 *
 * So transcripts live *beside* the journal, one file per attempt:
 *
 * ```
 * ~/.minnow/boards/<boardId>/attempts/<attemptId>.jsonl
 * ```
 *
 * Deleting the whole directory must change nothing except what the detail panel
 * can show. Nothing derives from these files, nothing replays them, and the fold
 * has never heard of them — which is the property that lets them be lossy.
 *
 * ## Lossy on purpose
 *
 * Writes are fire-and-forget and capped ({@link MAX_LINES}). A transcript that
 * loses its tail is a worse read; a transcript that can stall or fail an attempt
 * is a worse orchestrator. Every write path here swallows its errors.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { boardDir } from './journal.js';

/**
 * Lines kept per attempt.
 *
 * Enough to read what a long attempt did, bounded so a runaway tool loop cannot
 * fill a disk. Once reached, the file stops growing and the reader is told the
 * transcript was capped rather than silently shown a partial one.
 */
export const MAX_LINES = 5_000;

/** Bytes kept per line. Tool results can be enormous; the shape is the point. */
const MAX_LINE_BYTES = 8_000;

/**
 * @param {string} boardId
 * @returns {string}
 */
export function attemptsDir(boardId) {
  return path.join(boardDir(boardId), 'attempts');
}

/**
 * Attempt ids reach here from HTTP, so they are never interpolated into a path
 * unchecked — the same rule `journal.js` applies to board ids.
 *
 * @param {string} attemptId
 * @returns {string}
 */
function safeAttemptId(attemptId) {
  const id = String(attemptId ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) {
    throw new Error(`invalid attempt id: ${JSON.stringify(attemptId)}`);
  }
  return id;
}

/**
 * @param {string} boardId
 * @param {string} attemptId
 * @returns {string}
 */
export function transcriptPath(boardId, attemptId) {
  return path.join(attemptsDir(boardId), `${safeAttemptId(attemptId)}.jsonl`);
}

/**
 * Event types whose `text` grows in place rather than arriving in pieces.
 *
 * `run-turn.js` emits `thinking` from `onLiveActivity` every time
 * `partialReasoning` changes, and that field is the reasoning block *so far*.
 * Appending each one produced a transcript that was ninety percent duplicated
 * prefixes ("Let me start", "Let me start by", "Let me start by exploring"),
 * unreadable to a person and expensive against {@link MAX_LINES}.
 *
 * So a growing type is held as one pending line and rewritten in place until
 * something else happens. See {@link recordTranscriptEvent}.
 */
const COALESCING_TYPES = new Set(['thinking']);

/**
 * One append queue per file, a line count, and the pending coalesced line.
 *
 * Serialised for the same reason the journal is: two concurrent appends would
 * order their bytes but not their content, and a half-written JSON line is a
 * line the reader has to throw away.
 *
 * @type {Map<string, { chain: Promise<unknown>, lines: number, capped: boolean,
 *                      pending: { boardId: string, line: Record<string, unknown> } | null }>}
 */
const writers = new Map();

/**
 * @param {string} key
 * @returns {{ chain: Promise<unknown>, lines: number, capped: boolean,
 *             pending: { boardId: string, line: Record<string, unknown> } | null }}
 */
function writerFor(key) {
  let entry = writers.get(key);
  if (!entry) {
    entry = { chain: Promise.resolve(), lines: 0, capped: false, pending: null };
    writers.set(key, entry);
  }
  return entry;
}

/**
 * Trim a value down to something worth reading.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function clip(value) {
  if (typeof value !== 'string') return value;
  return value.length > MAX_LINE_BYTES ? `${value.slice(0, MAX_LINE_BYTES)}… [clipped]` : value;
}

/**
 * Queue one already-built line for append, counting it against the cap.
 *
 * @param {string} file
 * @param {string} boardId
 * @param {Record<string, unknown>} line
 * @returns {void}
 */
function appendLine(file, boardId, line) {
  const writer = writerFor(file);
  if (writer.capped) return;
  writer.lines += 1;
  if (writer.lines > MAX_LINES) {
    writer.capped = true;
    return;
  }
  const text = `${JSON.stringify(line)}\n`;
  writer.chain = writer.chain
    .then(async () => {
      await fs.mkdir(attemptsDir(boardId), { recursive: true });
      await fs.appendFile(file, text, 'utf8');
    })
    .catch(() => {
      // Lossy by design — see the module comment.
    });
}

/**
 * Write out the held coalesced line, if there is one.
 *
 * Called before appending anything else and by {@link flushTranscripts}, so the
 * pending line always lands in the order it was produced.
 *
 * @param {string} file
 * @returns {void}
 */
function flushPending(file) {
  const writer = writers.get(file);
  const pending = writer?.pending;
  if (!writer || !pending) return;
  writer.pending = null;
  appendLine(file, pending.boardId, pending.line);
}

/**
 * Record one turn event for an attempt.
 *
 * Never awaited by a caller on the attempt's critical path, and never able to
 * throw into one: a transcript is a convenience, and an attempt that fails
 * because its transcript could not be written would be a worse trade than a
 * transcript with a hole in it.
 *
 * Token deltas are dropped. They are the bulk of the stream and add nothing a
 * reader wants — the tool calls and their results are the story.
 *
 * Reasoning is *coalesced* rather than dropped, because unlike a token delta it
 * is worth reading once it is whole. Each `thinking` event carries the block so
 * far, so the newest one supersedes the pending one whenever it extends it, and
 * only starts a second line when the model began a genuinely new block.
 *
 * @param {{ boardId: string, attemptId: string, taskId?: string | null, role?: string,
 *          event: Record<string, unknown> }} entry
 * @returns {void}
 */
export function recordTranscriptEvent(entry) {
  const { boardId, attemptId, event } = entry;
  if (!boardId || !attemptId || !event) return;
  const type = typeof event.type === 'string' ? event.type : '';
  if (!type || type === 'token' || type === 'delta' || type === 'reasoning_delta') return;

  /** @type {string} */
  let file;
  try {
    file = transcriptPath(boardId, attemptId);
  } catch {
    return; // an id that cannot be a path is not worth failing an attempt over
  }

  const writer = writerFor(file);
  if (writer.capped) return;

  /** @type {Record<string, unknown>} */
  const line = { ts: Date.now(), type };
  // `content` is where `run-turn.js` puts a tool's output. Without it the log
  // could say which tools ran but never what any of them came back with, which
  // is half of "what did it actually do".
  for (const key of ['name', 'text', 'summary', 'error', 'id', 'content']) {
    if (event[key] !== undefined) line[key] = clip(event[key]);
  }
  if (event.arguments !== undefined) line.arguments = clip(event.arguments);
  if (event.result !== undefined) line.result = clip(event.result);
  if (entry.role) line.role = entry.role;

  if (!COALESCING_TYPES.has(type) || typeof line.text !== 'string') {
    flushPending(file);
    appendLine(file, boardId, line);
    return;
  }

  const held = writer.pending;
  if (held && held.line.type === type && typeof held.line.text === 'string') {
    // Same block, one character longer. Keep whichever text is the superset so
    // a late shorter snapshot cannot truncate what was already captured.
    const previous = /** @type {string} */ (held.line.text);
    const next = /** @type {string} */ (line.text);
    if (next.startsWith(previous)) {
      held.line.text = next;
      return;
    }
    if (previous.startsWith(next)) return;
  }
  flushPending(file);
  writer.pending = { boardId, line };
}

/**
 * Record how an attempt ended, as the transcript's last line.
 *
 * @param {{ boardId: string, attemptId: string, outcome: string, summary?: string }} end
 * @returns {void}
 */
export function recordTranscriptEnd(end) {
  recordTranscriptEvent({
    boardId: end.boardId,
    attemptId: end.attemptId,
    event: {
      type: 'attempt_end',
      name: end.outcome,
      ...(end.summary === undefined ? {} : { summary: end.summary }),
    },
  });
}

/**
 * Wait for everything queued for an attempt to reach disk.
 *
 * For tests and for the read endpoint, which would otherwise race the very
 * writes that produced the attempt it is being asked about.
 *
 * @param {string} boardId
 * @param {string} [attemptId] all attempts when omitted
 * @returns {Promise<void>}
 */
export async function flushTranscripts(boardId, attemptId) {
  if (attemptId) {
    const file = transcriptPath(boardId, attemptId);
    flushPending(file);
    await writers.get(file)?.chain;
    return;
  }
  for (const file of [...writers.keys()]) flushPending(file);
  await Promise.all([...writers.values()].map((w) => w.chain));
}

/**
 * Read one attempt's transcript.
 *
 * A missing file is an empty transcript, not an error: an attempt that has not
 * called a tool yet has nothing to show, and so does an attempt from a build
 * before this existed.
 *
 * @param {string} boardId
 * @param {string} attemptId
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ events: Record<string, unknown>[], truncated: boolean, capped: boolean }>}
 */
export async function readTranscript(boardId, attemptId, options = {}) {
  const file = transcriptPath(boardId, attemptId);
  // Await the queue, but leave the pending reasoning block *in* the buffer: a
  // reader watching a running attempt should see the block as it stands, and
  // writing it out here would strand a prefix on disk that the finished block
  // then repeats.
  await writers.get(file)?.chain;
  const pending = writers.get(file)?.pending?.line ?? null;

  /** @type {string} */
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return {
        events: pending ? [{ ...pending }] : [],
        truncated: false,
        capped: false,
      };
    }
    throw err;
  }

  /** @type {Record<string, unknown>[]} */
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') events.push(parsed);
    } catch {
      // A torn last line is the normal cost of an append-only file that was
      // being written when the process died. Skip it, keep the rest.
    }
  }

  if (pending) events.push({ ...pending });
  // Older transcripts were written one line per reasoning snapshot, so fold
  // them on the way out too. New ones coalesce at the write and pass through.
  const folded = coalesceEvents(events);

  const limit = Number.isSafeInteger(options.limit) && Number(options.limit) > 0
    ? Number(options.limit)
    : 0;
  const truncated = limit > 0 && folded.length > limit;
  return {
    events: truncated ? folded.slice(-limit) : folded,
    truncated,
    capped: writers.get(file)?.capped ?? false,
  };
}

/**
 * Collapse runs of prefix-extending events of the same coalescing type.
 *
 * Exported for the read endpoint's tests and because transcripts written before
 * the write-side fix are still on disk: a board from last week has one line per
 * keystroke of reasoning, and that file is never rewritten.
 *
 * @param {readonly Record<string, unknown>[]} events
 * @returns {Record<string, unknown>[]}
 */
export function coalesceEvents(events) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const event of events ?? []) {
    const type = typeof event?.type === 'string' ? event.type : '';
    const text = typeof event?.text === 'string' ? event.text : null;
    const last = out[out.length - 1];
    if (
      text !== null &&
      COALESCING_TYPES.has(type) &&
      last &&
      last.type === type &&
      typeof last.text === 'string'
    ) {
      const previous = /** @type {string} */ (last.text);
      if (text.startsWith(previous)) {
        out[out.length - 1] = { ...last, ...event, text };
        continue;
      }
      if (previous.startsWith(text)) continue;
    }
    out.push(event);
  }
  return out;
}

/**
 * Drop the per-process writer state. For tests that move `MINNOW_HOME`.
 *
 * @returns {void}
 */
export function resetTranscripts() {
  writers.clear();
}
