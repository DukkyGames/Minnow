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

/**
 * Per-request tool context:
 * - allowOutsideWorkspace: full filesystem access when true
 * - workspaceRootOverride: optional cwd/root for chat-scoped tool runs
 */
export const pathAccessStore = new AsyncLocalStorage();

const ALLOW_ALL_PATHS = process.env.TOOLS_ALLOW_ALL_PATHS === '1';

/** Active workspace root for the current tool request (override or Code workspace). */
export function getEffectiveWorkspaceRoot() {
  const store = pathAccessStore.getStore();
  if (store?.workspaceRootOverride) {
    return store.workspaceRootOverride;
  }
  return getWorkspaceRoot();
}

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

  const workspaceRoot = getEffectiveWorkspaceRoot();
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
    `Path "${userPath}" resolves outside the workspace directory. Enable full disk access in Settings → General → Filesystem access (dangerous) or set TOOLS_ALLOW_ALL_PATHS=1 for automation.`,
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

/**
 * Run tool handlers with optional workspace root override (validated by caller).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ allowOutsideWorkspace?: boolean, workspaceRoot?: string }} [options]
 * @returns {Promise<T>}
 */
export async function runWithToolContext(fn, options = {}) {
  const fsAccess = await getFilesystemAccessFromConfig();
  const allowOutsideWorkspace =
    options.allowOutsideWorkspace ?? fsAccess === 'full';
  const store = {
    allowOutsideWorkspace,
    ...(options.workspaceRoot ? { workspaceRootOverride: options.workspaceRoot } : {}),
  };
  return pathAccessStore.run(store, fn);
}
