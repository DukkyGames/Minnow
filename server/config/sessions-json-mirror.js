/**
 * Rotating JSON mirror of the SQLite sessions store → state.json.backup.
 * Debounced while dirty; flushed on closeSessionsDb().
 */

import fs from 'node:fs';
import {
  sessionsDbPath,
  sessionsJsonBackupPath,
  sessionsRootDir,
} from './sessions-paths.js';

const MIRROR_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * Skip the mirror once the store exceeds this. The mirror is a convenience backup of
 * data that is already durable in SQLite, so it is not worth an unbounded string
 * allocation: two runaway tool results once made this serialize 409 MB every 5
 * minutes, which dominated the heap's large-object space and stalled the event loop
 * on each flush. Sized to keep mirroring a healthy store (~100 MB) while still
 * refusing the pathological case.
 */
const MIRROR_MAX_BYTES = 128 * 1024 * 1024;

let skipWarned = false;

/** @type {null | (() => unknown)} */
let stateSource = null;
let dirty = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;

/** Register a sync reader used when flushing the mirror (avoids import cycles). */
export function registerSessionsJsonMirrorSource(fn) {
  stateSource = fn;
}

/** Mark the mirror dirty and schedule a lazy flush (5 minutes). */
export function markSessionsJsonMirrorDirty() {
  dirty = true;
  if (timer != null) return;
  timer = setTimeout(() => {
    timer = null;
    // Background flush: the write must not block the event loop. Shutdown still
    // flushes synchronously via closeSessionsDb().
    flushSessionsJsonMirror({ sync: false });
  }, MIRROR_DEBOUNCE_MS);
  // Don't keep the process alive solely for the mirror timer.
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    timer.unref();
  }
}

/**
 * Write state.json.backup immediately when dirty (also used from closeSessionsDb).
 * @param {{ sync?: boolean }} [options] sync writes block — required during shutdown,
 *   where the DB handle closes as soon as this returns.
 */
export function flushSessionsJsonMirror({ sync = true } = {}) {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty || typeof stateSource !== 'function') return false;
  try {
    // Bail out before building the state graph: reading it and stringifying it are
    // both proportional to the store, so checking after the fact would already have
    // cost the allocation this guard exists to prevent. The on-disk DB is a close
    // enough proxy for the serialized size.
    let dbBytes = 0;
    try {
      dbBytes = fs.statSync(sessionsDbPath()).size;
    } catch {
      /* first run — no DB yet, fall through and mirror normally */
    }
    if (dbBytes > MIRROR_MAX_BYTES) {
      if (!skipWarned) {
        skipWarned = true;
        console.warn(
          `[sessions] JSON mirror skipped: sessions.db is ${Math.round(dbBytes / 1048576)} MB ` +
            `(limit ${Math.round(MIRROR_MAX_BYTES / 1048576)} MB). SQLite remains the source of truth.`,
        );
      }
      dirty = false;
      return false;
    }

    const state = stateSource();
    fs.mkdirSync(sessionsRootDir(), { recursive: true });
    const body = `${JSON.stringify(state)}\n`;
    dirty = false;
    skipWarned = false;
    if (sync) {
      fs.writeFileSync(sessionsJsonBackupPath(), body, 'utf8');
      return true;
    }
    fs.promises
      .writeFile(sessionsJsonBackupPath(), body, 'utf8')
      .catch((err) => console.warn('[sessions] JSON mirror flush failed:', err));
    return true;
  } catch (err) {
    console.warn('[sessions] JSON mirror flush failed:', err);
    return false;
  }
}

/** Test helper — whether a flush is pending. */
export function sessionsJsonMirrorDirtyForTests() {
  return dirty;
}
