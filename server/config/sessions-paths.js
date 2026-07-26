/**
 * Filesystem paths for the sessions SQLite store and legacy JSON blob.
 * Bypasses ALLOWED_CONFIG_FILES deliberately (same pattern as email/paths.js).
 */

import path from 'node:path';
import { getMinnowHome } from './home.js';

/** Root sessions directory under ~/.minnow/sessions. */
export function sessionsRootDir() {
  return path.join(getMinnowHome(), 'sessions');
}

/** SQLite sessions store (~/.minnow/sessions/sessions.db). */
export function sessionsDbPath() {
  return path.join(sessionsRootDir(), 'sessions.db');
}

/** Legacy whole-blob JSON (~/.minnow/sessions/state.json). */
export function sessionsJsonPath() {
  return path.join(sessionsRootDir(), 'state.json');
}

/** Rotating JSON mirror written after successful SQLite saves (Phase A.2). */
export function sessionsJsonBackupPath() {
  return path.join(sessionsRootDir(), 'state.json.backup');
}

/** One-time import retirement path (never deleted — only renamed). */
export function sessionsJsonMigratedPath() {
  return `${sessionsJsonPath()}.migrated`;
}
