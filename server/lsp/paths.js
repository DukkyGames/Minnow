/**
 * LSP binary search paths: workspace → app bundle → ~/.minnow/lsp-servers → system PATH.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { getAppRoot } from '../workspace/root.js';
import { getEffectiveWorkspaceRoot } from '../runtime/path-access.js';

/** User-managed LSP install root (~/.minnow/lsp-servers). */
export function getManagedLspRoot() {
  return path.join(getMinnowHome(), 'lsp-servers');
}

/** npm --prefix target for on-demand language server packages. */
export function getManagedLspNpmRoot() {
  return getManagedLspRoot();
}

/** Downloaded native binaries (rust-analyzer, gopls, …). */
export function getManagedLspBinDir() {
  return path.join(getManagedLspRoot(), 'bin');
}

/** Metadata written after install (version, size, checksum). */
export function getManagedLspMetaPath(bundleId) {
  return path.join(getManagedLspRoot(), 'meta', `${bundleId}.json`);
}

/**
 * Ordered directories to search for an executable name (no extension probing on Unix).
 * @param {string} [workspaceRoot]
 * @returns {string[]}
 */
export function getLspSearchPaths(workspaceRoot = getEffectiveWorkspaceRoot()) {
  const appRoot = getAppRoot();
  const managed = getManagedLspRoot();
  return [
    path.join(workspaceRoot, 'node_modules', '.bin'),
    path.join(appRoot, 'node_modules', '.bin'),
    path.join(managed, 'node_modules', '.bin'),
    getManagedLspBinDir(),
  ];
}

/**
 * @param {string} name - executable base name (e.g. gopls)
 * @param {string[]} searchPaths
 * @returns {string | undefined}
 */
export function findExecutableInPaths(name, searchPaths) {
  if (!name || typeof name !== 'string') return undefined;
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`]
    : [name];

  for (const dir of searchPaths) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const file of candidates) {
      const full = path.join(dir, file);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        if (isWin && fs.existsSync(full)) {
          return full;
        }
      }
    }
  }
  return undefined;
}

/**
 * Merge LSP search paths ahead of the process PATH for spawn().
 * @param {NodeJS.ProcessEnv} baseEnv
 * @param {string} [workspaceRoot]
 * @returns {NodeJS.ProcessEnv}
 */
export function buildLspProcessEnv(baseEnv = process.env, workspaceRoot = getEffectiveWorkspaceRoot()) {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const prefix = getLspSearchPaths(workspaceRoot).join(path.delimiter);
  const existing = baseEnv[pathKey] ?? process.env[pathKey] ?? '';
  return {
    ...baseEnv,
    [pathKey]: prefix ? `${prefix}${path.delimiter}${existing}` : existing,
  };
}
