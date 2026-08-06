/**
 * Open a workspace file or folder in the OS file explorer (Finder / Explorer / Files).
 *
 * Files: reveal/select the item in its parent folder when the platform supports it.
 * Folders: open that folder itself.
 */

import { exec, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * @typedef {{
 *   command: string,
 *   args: string[],
 *   detached?: boolean,
 *   windowsVerbatimArguments?: boolean,
 * }} RevealCommand
 */

/**
 * explorer.exe treats `/segment` in arguments as switches. Paths must use `\` and
 * file reveal uses a single `/select,"path"` token (spaces require quoting).
 *
 * @param {string} absolutePath
 * @returns {string}
 */
export function formatPathForWindowsExplorer(absolutePath) {
  const normalized = path.win32.normalize(String(absolutePath).trim().replace(/\//g, '\\'));
  if (path.win32.isAbsolute(normalized)) {
    return normalized;
  }
  return path.win32.resolve(normalized);
}

/**
 * Build the platform-specific command used to open/reveal a path.
 * Pure helper — easy to unit-test without spawning a real explorer.
 *
 * @param {NodeJS.Platform} platform
 * @param {string} absolutePath
 * @param {boolean} isDirectory
 * @returns {RevealCommand}
 */
export function buildRevealCommand(platform, absolutePath, isDirectory) {
  if (platform === 'win32') {
    const explorerPath = formatPathForWindowsExplorer(absolutePath);
    // explorer.exe often exits non-zero even on success — spawn detached and ignore exit.
    if (isDirectory) {
      return {
        command: 'explorer.exe',
        args: [explorerPath],
        detached: true,
        windowsVerbatimArguments: true,
      };
    }
    return {
      command: 'explorer.exe',
      args: [`/select,"${explorerPath}"`],
      detached: true,
      windowsVerbatimArguments: true,
    };
  }

  const resolved = path.resolve(absolutePath);

  if (platform === 'darwin') {
    if (isDirectory) {
      return { command: 'open', args: [resolved] };
    }
    // Reveal and select the file in Finder.
    return { command: 'open', args: ['-R', resolved] };
  }

  // Linux / other — xdg-open opens a folder; for files open the parent.
  const target = isDirectory ? resolved : path.dirname(resolved);
  return { command: 'xdg-open', args: [target], detached: true };
}

/**
 * Run explorer via the shell on Windows — more reliable than raw spawn for /select.
 * @param {string} explorerPath
 * @param {boolean} isDirectory
 */
async function runWindowsExplorerReveal(explorerPath, isDirectory) {
  const escaped = explorerPath.replace(/"/g, '""');
  const command = isDirectory
    ? `explorer.exe "${escaped}"`
    : `explorer.exe /select,"${escaped}"`;
  await execAsync(command, { windowsHide: true });
}

/**
 * Spawn a reveal command. Detached processes resolve once spawned (explorer exit codes are noisy).
 * @param {RevealCommand} cmd
 * @param {{ spawnImpl?: typeof spawn, platform?: NodeJS.Platform, isDirectory?: boolean }} [deps]
 * @returns {Promise<void>}
 */
export function runRevealCommand(cmd, deps = {}) {
  const platform = deps.platform ?? process.platform;
  if (platform === 'win32' && cmd.command === 'explorer.exe') {
    const explorerPath = cmd.args.length === 1 && cmd.args[0].startsWith('/select,')
      ? cmd.args[0].slice('/select,'.length).replace(/^"|"$/g, '')
      : cmd.args[0];
    const isDirectory = deps.isDirectory ?? !cmd.args[0]?.startsWith('/select,');
    return runWindowsExplorerReveal(explorerPath, isDirectory);
  }

  const spawnImpl = deps.spawnImpl ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnImpl(cmd.command, cmd.args, {
      detached: Boolean(cmd.detached),
      stdio: 'ignore',
      windowsHide: true,
      ...(cmd.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    child.on('error', reject);
    if (cmd.detached) {
      child.unref();
      // Allow the 'error' event a tick to fire before treating spawn as success.
      setImmediate(resolve);
      return;
    }
    child.on('close', (code) => {
      if (code === 0 || code == null) {
        resolve();
        return;
      }
      reject(new Error(`${cmd.command} exited with code ${code}`));
    });
  });
}

/**
 * Resolve existence + kind, then open/reveal in the system explorer.
 * @param {string} absolutePath
 * @param {{ platform?: NodeJS.Platform, spawnImpl?: typeof spawn, statImpl?: typeof fs.stat, skipSpawn?: boolean }} [deps]
 * @returns {Promise<{ ok: true, path: string, kind: 'file' | 'dir' }>}
 */
export async function revealInSystemExplorer(absolutePath, deps = {}) {
  if (!absolutePath || typeof absolutePath !== 'string') {
    throw new Error('path is required');
  }

  const resolved = path.resolve(absolutePath);
  const statImpl = deps.statImpl ?? fs.stat;
  let stats;
  try {
    stats = await statImpl(resolved);
  } catch {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  const isDirectory = stats.isDirectory();
  const kind = isDirectory ? 'dir' : 'file';
  const platform = deps.platform ?? process.platform;
  const cmd = buildRevealCommand(platform, resolved, isDirectory);
  if (!deps.skipSpawn) {
    await runRevealCommand(cmd, {
      spawnImpl: deps.spawnImpl,
      platform,
      isDirectory,
    });
  }

  return { ok: true, path: resolved, kind };
}
