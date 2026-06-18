/**
 * Controller run persistence paths under ~/.minnow/runs/.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Sanitize ids for safe file names. */
export function sanitizeRunId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Root runs directory. */
export function runsDir() {
  return path.join(getMinnowHome(), 'runs');
}

/** Per-run registry mirror directory. */
export function registryDir() {
  return path.join(runsDir(), 'registry');
}

/** Write-ahead committed results directory. */
export function resultsDir() {
  return path.join(runsDir(), 'results');
}

/** Absolute path for a registry entry file. */
export function registryFilePath(runId) {
  return path.join(registryDir(), `${sanitizeRunId(runId)}.json`);
}

/** Absolute path for a committed result file. */
export function resultFilePath(key) {
  return path.join(resultsDir(), `${sanitizeRunId(key)}.json`);
}

/** Stable result key from board task id and dispatch attempt. */
export function buildResultKey(boardTaskId, attempt) {
  return `${sanitizeRunId(boardTaskId)}__${attempt}`;
}
