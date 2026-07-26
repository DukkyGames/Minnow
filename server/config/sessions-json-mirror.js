/**
 * Rotating JSON mirror of the SQLite sessions store → state.json.backup.
 * Debounced while dirty; flushed on closeSessionsDb().
 */

import fs from 'node:fs';
import { sessionsJsonBackupPath, sessionsRootDir } from './sessions-paths.js';

const MIRROR_DEBOUNCE_MS = 5 * 60 * 1000;

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
    flushSessionsJsonMirror();
  }, MIRROR_DEBOUNCE_MS);
  // Don't keep the process alive solely for the mirror timer.
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    timer.unref();
  }
}

/** Write state.json.backup immediately when dirty (also used from closeSessionsDb). */
export function flushSessionsJsonMirror() {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty || typeof stateSource !== 'function') return false;
  try {
    const state = stateSource();
    fs.mkdirSync(sessionsRootDir(), { recursive: true });
    const body = `${JSON.stringify(state, null, 2)}\n`;
    fs.writeFileSync(sessionsJsonBackupPath(), body, 'utf8');
    dirty = false;
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
