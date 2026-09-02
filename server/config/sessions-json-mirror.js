import fs from 'node:fs';
import {
  sessionsDbPath,
  sessionsJsonBackupPath,
  sessionsRootDir,
} from './sessions-paths.js';

const MIRROR_DEBOUNCE_MS = 5 * 60 * 1000;

const MIRROR_MAX_BYTES = 128 * 1024 * 1024;

let skipWarned = false;

/** @type {null | (() => unknown)} */
let stateSource = null;
let dirty = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;

export function registerSessionsJsonMirrorSource(fn) {
  stateSource = fn;
}

export function markSessionsJsonMirrorDirty() {
  dirty = true;
  if (timer != null) return;
  timer = setTimeout(() => {
    timer = null;
    flushSessionsJsonMirror({ sync: false });
  }, MIRROR_DEBOUNCE_MS);
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    timer.unref();
  }
}

/**
 * @param {{ sync?: boolean }} [options]
 */
export function flushSessionsJsonMirror({ sync = true } = {}) {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty || typeof stateSource !== 'function') return false;
  try {
    let dbBytes = 0;
    try {
      dbBytes = fs.statSync(sessionsDbPath()).size;
    } catch {
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

export function sessionsJsonMirrorDirtyForTests() {
  return dirty;
}
