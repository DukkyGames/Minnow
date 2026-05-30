/**
 * Workspace path resolution and per-request filesystem access scope (AsyncLocalStorage).
 * Shared by /api/tools, /api/preview, and future Electron HTTP host.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { getFilesystemAccessFromConfig } from '../config/tool-security.js';
import { tryResolveReefArtifactPath } from '../reef/artifact-paths.js';
import {
  isReefWidgetPathAlias,
  tryResolveReefModulePath,
  tryResolveReefWidgetReadPath,
} from '../reef/widget-paths.js';
import { getWorkspaceRoot } from '../workspace/root.js';
import { isResolvedPathUnderRoot } from '../workspace/safe-path.js';

/** Per-request flag: allow paths outside workspace when config grants full filesystem access. */
export const pathAccessStore = new AsyncLocalStorage();

const ALLOW_ALL_PATHS = process.env.TOOLS_ALLOW_ALL_PATHS === '1';

/**
 * Resolve a user-supplied path under the workspace root unless full access is allowed
 * (TOOLS_ALLOW_ALL_PATHS=1 or persisted toolSecurity.filesystemAccess === 'full').
 * Returns absolute path string, or throws with a message suitable for tool results.
 * @param {string} userPath
 * @param {{ write?: boolean }} [options]
 */
export function resolveSafePath(userPath, options = {}) {
  if (!userPath || typeof userPath !== 'string') {
    throw new Error('Path is required');
  }

  const reefModule = tryResolveReefModulePath(userPath);
  if (reefModule) {
    return reefModule;
  }

  const reefArtifact = tryResolveReefArtifactPath(userPath);
  if (reefArtifact) {
    return reefArtifact;
  }

  if (options.write && isReefWidgetPathAlias(userPath)) {
    throw new Error(
      'Reef widget templates under @minnow/reef/widgets are read-only. Save custom Reef modules to @minnow/reef/modules/<slug>.md.',
    );
  }

  const reefRead = tryResolveReefWidgetReadPath(userPath);
  if (reefRead) {
    return reefRead;
  }

  const workspaceRoot = getWorkspaceRoot();
  const resolved = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(workspaceRoot, userPath);

  const store = pathAccessStore.getStore();
  const allowOutside = ALLOW_ALL_PATHS || store?.allowOutsideWorkspace === true;

  if (allowOutside) {
    return resolved;
  }

  if (isResolvedPathUnderRoot(resolved, workspaceRoot)) {
    return resolved;
  }

  throw new Error(
    `Path "${userPath}" resolves outside the workspace directory. Enable full filesystem access in Settings (dangerous) or set TOOLS_ALLOW_ALL_PATHS=1 for automation.`,
  );
}

/**
 * Run async work with filesystem access scope from persisted tool security config.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function runWithPathAccess(fn) {
  const fsAccess = await getFilesystemAccessFromConfig();
  return pathAccessStore.run({ allowOutsideWorkspace: fsAccess === 'full' }, fn);
}
