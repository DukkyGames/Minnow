/**
 * Resolve an orchestrator working directory without mangling Windows
 * drive-letter paths on POSIX (macOS/Linux CI).
 *
 * `path.resolve('C:\\repo')` on POSIX treats the string as relative and
 * joins it onto `process.cwd()`, which then shows up in human-facing
 * `runInstructions`. Windows-absolute paths must round-trip unchanged.
 */

import path from 'node:path';

/**
 * @param {unknown} cwd
 * @returns {string}
 */
export function resolveOrchestratorCwd(cwd) {
  const value = String(cwd ?? '').trim();
  if (!value) return process.cwd();
  if (path.isAbsolute(value)) return path.normalize(path.resolve(value));
  const winish = value.replace(/\//g, '\\');
  if (path.win32.isAbsolute(winish)) return path.win32.normalize(winish);
  return path.resolve(value);
}
