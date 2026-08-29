/**
 * P0-G — snapshot format and memoised fold.
 *
 * A six-hour AFK run produces thousands of events and the reconcile loop folds on
 * every tick. Resolved during planning (PRD §13.1): **keep the journal forever,
 * memoise the fold against a periodic snapshot.** Raw history is never compacted —
 * §11 needs it to retroactively measure how many abandonments a smarter policy
 * would have saved.
 *
 * ## The rule that keeps this safe
 *
 * **A snapshot is a cache, never a source.** Deleting every snapshot file must
 * change nothing except speed. If a snapshot and the journal disagree, the
 * journal wins and the snapshot is discarded — no merge, no repair, no
 * reconciliation. The moment a snapshot can carry state the journal cannot
 * reproduce, V2 has V1's bug back.
 *
 * So there is exactly one failure response in this module: fall back to a full
 * fold. There is no code path that patches a snapshot, and there must never be.
 *
 * ## Scope
 *
 * Pure. Writing the file is P1-A's job; this module owns the format, the digest,
 * and the resume logic.
 */

import { derive, emptyState, foldInto } from './derive.js';

/** Bump when the snapshot shape changes. A mismatch is ignored, never migrated. */
export const SNAPSHOT_VERSION = 1;

/** Write a snapshot every this many events. Read by P1-A's journal store. */
export const SNAPSHOT_INTERVAL = 200;

/**
 * Is this the seq at which a snapshot is due?
 *
 * @param {number} seq
 * @returns {boolean}
 */
export function shouldSnapshot(seq) {
  return Number.isSafeInteger(seq) && seq > 0 && seq % SNAPSHOT_INTERVAL === 0;
}

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

/**
 * Convert a value to a JSON-safe canonical shape: object keys sorted, `Map`s as
 * entry arrays sorted by key.
 *
 * Canonical means two equal states produce byte-identical JSON whatever order
 * their Maps were built in. This is the on-disk format; the digest below walks
 * the live object instead, for speed.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalise(value) {
  if (value instanceof Map) {
    return {
      __map: [...value.entries()]
        .map(([key, entry]) => [String(key), canonicalise(entry)])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    };
  }
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalise(/** @type {Record<string, unknown>} */ (value)[key]);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

/**
 * Rebuild a value from its canonical form.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function decanonicalise(value) {
  if (Array.isArray(value)) return value.map(decanonicalise);
  if (value && typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (value);
    if (Array.isArray(record.__map) && Object.keys(record).length === 1) {
      /** @type {Map<string, unknown>} */
      const map = new Map();
      for (const pair of record.__map) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        map.set(String(pair[0]), decanonicalise(pair[1]));
      }
      return map;
    }
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(record)) out[key] = decanonicalise(record[key]);
    return out;
  }
  return value;
}

/**
 * The state as it is written to disk.
 *
 * @param {import('./types').BoardState} state
 * @returns {unknown}
 */
export function stateToJSON(state) {
  return canonicalise(state);
}

/**
 * A state read back from disk, with the empty-state defaults filled in so a
 * snapshot written by an older build still produces a usable object.
 *
 * @param {unknown} raw
 * @returns {import('./types').BoardState}
 */
export function stateFromJSON(raw) {
  const restored = /** @type {Record<string, unknown>} */ (decanonicalise(raw) ?? {});
  const state = emptyState();
  for (const key of Object.keys(state)) {
    if (restored[key] !== undefined) {
      /** @type {any} */ (state)[key] = restored[key];
    }
  }
  if (!(state.tasks instanceof Map)) state.tasks = new Map();
  return state;
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

/**
 * Structural tags, mixed before each node so that `['a']`, `'a'`, and
 * `{ 0: 'a' }` cannot collide, and a truncated structure cannot hash as a
 * complete one.
 */
const TAG = {
  NULL: 1,
  MAP: 2,
  MAP_END: 3,
  ARRAY: 4,
  ARRAY_END: 5,
  OBJECT: 6,
  OBJECT_END: 7,
  KEY: 8,
  NUMBER: 9,
  TRUE: 10,
  FALSE: 11,
  STRING: 12,
  NEGATIVE: 13,
  POSITIVE: 14,
};

/**
 * Mix one code unit into both lanes.
 *
 * The whole digest is built from this and it allocates nothing — which is the
 * point. Verification runs on every state load, and an earlier version that
 * canonicalised into a parallel object tree and a 390 KB JSON string cost 2.0 ms
 * against a 2.4 ms full fold, so the snapshot bought nothing at all.
 *
 * @param {{ a: number, b: number, n: number }} lanes
 * @param {number} code
 * @returns {void}
 */
function mix(lanes, code) {
  lanes.a = Math.imul(lanes.a ^ code, 0x01000193) >>> 0;
  lanes.b = Math.imul(lanes.b ^ ((code << 5) | (code >>> 3)), 0x85ebca6b) >>> 0;
  lanes.n += 1;
}

/**
 * @param {{ a: number, b: number, n: number }} lanes
 * @param {string} text
 * @returns {void}
 */
function mixString(lanes, text) {
  for (let i = 0; i < text.length; i += 1) mix(lanes, text.charCodeAt(i));
}

/**
 * @param {{ a: number, b: number, n: number }} lanes
 * @param {number} value
 * @returns {void}
 */
function mixNumber(lanes, value) {
  if (Number.isSafeInteger(value)) {
    // In 16-bit limbs rather than through a decimal string, so no allocation.
    let remaining = value < 0 ? -value : value;
    mix(lanes, value < 0 ? TAG.NEGATIVE : TAG.POSITIVE);
    do {
      mix(lanes, remaining & 0xffff);
      remaining = Math.floor(remaining / 0x10000);
    } while (remaining > 0);
    return;
  }
  mixString(lanes, String(value));
}

/**
 * Walk a value canonically — object keys sorted, `Map`s by sorted entry —
 * streaming straight into the digest.
 *
 * @param {{ a: number, b: number, n: number }} lanes
 * @param {unknown} value
 * @returns {void}
 */
function absorb(lanes, value) {
  if (value === null || value === undefined) {
    mix(lanes, TAG.NULL);
    return;
  }
  const type = typeof value;
  if (type === 'string') {
    mix(lanes, TAG.STRING);
    mixString(lanes, /** @type {string} */ (value));
    return;
  }
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      mix(lanes, TAG.NULL);
      return;
    }
    mix(lanes, TAG.NUMBER);
    mixNumber(lanes, /** @type {number} */ (value));
    return;
  }
  if (type === 'boolean') {
    mix(lanes, value ? TAG.TRUE : TAG.FALSE);
    return;
  }
  if (value instanceof Map) {
    mix(lanes, TAG.MAP);
    const keys = [...value.keys()].map(String).sort();
    for (let i = 0; i < keys.length; i += 1) {
      mix(lanes, TAG.KEY);
      mixString(lanes, keys[i]);
      absorb(lanes, value.get(keys[i]));
    }
    mix(lanes, TAG.MAP_END);
    return;
  }
  if (Array.isArray(value)) {
    mix(lanes, TAG.ARRAY);
    for (let i = 0; i < value.length; i += 1) absorb(lanes, value[i]);
    mix(lanes, TAG.ARRAY_END);
    return;
  }
  if (type === 'object') {
    mix(lanes, TAG.OBJECT);
    const record = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(record).sort();
    for (let i = 0; i < keys.length; i += 1) {
      mix(lanes, TAG.KEY);
      mixString(lanes, keys[i]);
      absorb(lanes, record[keys[i]]);
    }
    mix(lanes, TAG.OBJECT_END);
    return;
  }
  mix(lanes, TAG.STRING);
  mixString(lanes, String(value));
}

/**
 * A stable, order-independent digest.
 *
 * FNV-1a in two interleaved 32-bit lanes, so the result is 64 bits wide.
 * Hand-rolled because the core imports nothing — including `node:crypto`, which
 * does not exist in the renderer anyway.
 *
 * This detects a stale or corrupt snapshot. It is not a security primitive and
 * nothing here should treat it as one.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function hashState(value) {
  const lanes = { a: 0x811c9dc5, b: 0x01000193, n: 0 };
  absorb(lanes, value);
  // Mix the node count in, so two values differing only by empty trailing
  // structure cannot collide cheaply.
  const a = Math.imul(lanes.a ^ lanes.n, 0xc2b2ae35) >>> 0;
  return `${a.toString(16).padStart(8, '0')}${lanes.b.toString(16).padStart(8, '0')}`;
}

/**
 * The digest actually stored on a snapshot.
 *
 * It covers the **envelope as well as the state** — version, board, and above
 * all `throughSeq`. Hashing the state alone leaves the anchor unprotected: a
 * snapshot whose `throughSeq` drifted forward would verify clean, and every
 * event between the real anchor and the claimed one would be silently skipped.
 * A quietly wrong board is the one outcome this module exists to prevent.
 *
 * @param {string} boardId
 * @param {number} throughSeq
 * @param {import('./types').BoardState} state
 * @returns {string}
 */
export function hashSnapshot(boardId, throughSeq, state) {
  return hashState(['snapshot', SNAPSHOT_VERSION, String(boardId ?? ''), throughSeq, state]);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * Build a snapshot of a state folded through `throughSeq`.
 *
 * @param {string} boardId
 * @param {import('./types').BoardState} state
 * @param {number} throughSeq  the last event folded in
 * @returns {import('./types').Snapshot}
 */
export function makeSnapshot(boardId, state, throughSeq) {
  return {
    v: SNAPSHOT_VERSION,
    boardId,
    throughSeq,
    stateHash: hashSnapshot(boardId, throughSeq, state),
    state: stateToJSON(state),
  };
}

/**
 * @param {unknown} event
 * @returns {number} 0 when the event carries no usable seq
 */
function seqOf(event) {
  const seq = /** @type {{ seq?: unknown }} */ (event)?.seq;
  return Number.isSafeInteger(seq) && /** @type {number} */ (seq) > 0
    ? /** @type {number} */ (seq)
    : 0;
}

/**
 * Highest `seq` present in a journal, or 0.
 *
 * @param {readonly unknown[]} events
 * @returns {number}
 */
function highestSeq(events) {
  let highest = 0;
  for (const event of events) {
    const seq = seqOf(event);
    if (seq > highest) highest = seq;
  }
  return highest;
}

/**
 * Does every event carry a distinct, usable `seq`?
 *
 * The precondition for resuming at all: the fold can only be split at an anchor
 * if every event sits unambiguously on one side of it.
 *
 * @param {readonly unknown[]} events
 * @returns {boolean}
 */
function isWellSequenced(events) {
  /** @type {Set<number>} */
  const seen = new Set();
  for (const event of events) {
    const seq = seqOf(event);
    if (seq === 0 || seen.has(seq)) return false;
    seen.add(seq);
  }
  return true;
}

/**
 * Does this journal slice include any event the snapshot already absorbed?
 *
 * The signal that the caller passed the whole journal rather than just the tail.
 *
 * @param {readonly unknown[]} events
 * @param {number} throughSeq
 * @returns {boolean}
 */
function coversHead(events, throughSeq) {
  for (const event of events) {
    const seq = seqOf(event);
    if (seq > 0 && seq <= throughSeq) return true;
  }
  return false;
}

/**
 * @param {readonly unknown[]} events
 * @param {number} seq
 * @returns {boolean}
 */
function hasSeq(events, seq) {
  for (const event of events) {
    if (seqOf(event) === seq) return true;
  }
  return false;
}

/**
 * The shared implementation of {@link isSnapshotUsable} and {@link deriveFrom}.
 *
 * Returns the restored state when the snapshot checks out, or null. Sharing it
 * means the state is rebuilt and the digest computed once per load rather than
 * twice, which is most of the point of having a snapshot at all.
 *
 * @param {unknown} snapshot
 * @param {readonly unknown[]} journal
 * @returns {import('./types').BoardState | null}
 */
function verifySnapshot(snapshot, journal) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const candidate = /** @type {import('./types').Snapshot} */ (snapshot);

  if (candidate.v !== SNAPSHOT_VERSION) return null;
  if (!Number.isSafeInteger(candidate.throughSeq) || candidate.throughSeq < 0) return null;
  if (typeof candidate.stateHash !== 'string' || candidate.stateHash.length === 0) return null;
  if (candidate.state === undefined || candidate.state === null) return null;

  // Resuming partitions the journal on `seq`, so every event must carry one.
  // An unsequenced or duplicated event cannot be placed on either side of the
  // anchor: `tailAfter` drops it while a full fold keeps it, and the result is a
  // board that silently differs from `derive(journal)` — here, a `board.started`
  // lost on restart, leaving a board that never ticks again while the snapshot
  // reports itself perfectly usable. Refuse and fold everything instead.
  if (!isWellSequenced(journal)) return null;

  if (candidate.throughSeq > highestSeq(journal)) return null;

  // The anchor event must be present — but only when the caller actually handed
  // over the head. A caller that passes just the tail (P1-A, which skips parsing
  // journal lines the snapshot already covers) supplies no event at or below
  // `throughSeq`, and for it the check is vacuous rather than failing. Requiring
  // the head unconditionally would force every load to parse the whole file,
  // which is the cost this module exists to avoid.
  //
  // A snapshot at seq 0 is the empty board and needs no anchor at all.
  if (candidate.throughSeq > 0 && coversHead(journal, candidate.throughSeq)) {
    if (!hasSeq(journal, candidate.throughSeq)) return null;
  }

  let restored;
  try {
    restored = stateFromJSON(candidate.state);
  } catch {
    return null;
  }
  if (hashSnapshot(candidate.boardId, candidate.throughSeq, restored) !== candidate.stateHash) {
    return null;
  }
  return restored;
}

/**
 * Can this snapshot be used to skip part of the fold?
 *
 * **`events` is the whole journal, not the tail.** The checks need to see the
 * event the snapshot claims to end at.
 *
 * False when the version mismatches, when the snapshot claims to be ahead of the
 * journal, when the event it claims to end at is missing, or when the recomputed
 * digest disagrees with the recorded one. **On false the caller does a full fold —
 * it never repairs.**
 *
 * @param {unknown} snapshot
 * @param {readonly unknown[]} events
 * @returns {boolean}
 */
export function isSnapshotUsable(snapshot, events) {
  return verifySnapshot(snapshot, Array.isArray(events) ? events : [...events]) !== null;
}

/**
 * The events a snapshot has not already absorbed, yielded lazily so resuming
 * does not allocate a copy of the journal it is trying to avoid folding.
 *
 * @param {readonly unknown[]} events
 * @param {number} throughSeq
 * @returns {Iterable<unknown>}
 */
function* tailAfter(events, throughSeq) {
  for (const event of events) {
    if (seqOf(event) > throughSeq) yield event;
  }
}

/**
 * Resume the fold from a snapshot, folding only the events after it.
 *
 * Equivalent to `derive(events)` by construction: when the snapshot is unusable
 * this *is* `derive(events)`, and when it is usable the events it skips are
 * exactly the ones already folded into it.
 *
 * ## What to pass as `events`
 *
 * Either the whole journal, or only the events after `snapshot.throughSeq`.
 * The whole journal is the safe default and is what a caller should pass unless
 * it has a reason not to.
 *
 * Passing only the tail is the fast path — it lets the caller skip parsing the
 * journal lines the snapshot already covers, which is the dominant cost of
 * loading a long board. **The price is that there is no safe fallback:** if the
 * snapshot turns out to be unusable, this folds the tail alone, which is a
 * different board. A tail-only caller must therefore verify the snapshot with
 * {@link isSnapshotUsable} *before* deciding not to read the head.
 *
 * @param {unknown} snapshot
 * @param {readonly unknown[]} events
 * @returns {import('./types').BoardState}
 */
export function deriveFrom(snapshot, events) {
  const journal = Array.isArray(events) ? events : [...events];
  // The restored state comes back from verification rather than being rebuilt:
  // it is a round-trip through the on-disk format, so a bug in that format shows
  // up on every load instead of only after a crash.
  const resumed = verifySnapshot(snapshot, journal);
  if (!resumed) return derive(journal);

  const { throughSeq } = /** @type {import('./types').Snapshot} */ (snapshot);
  return foldInto(resumed, tailAfter(journal, throughSeq));
}
