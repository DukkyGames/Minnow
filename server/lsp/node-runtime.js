/**
 * Node runtime used to spawn the bundled stdio language servers.
 *
 * A packaged Minnow cannot rely on a system `node`:
 *  - macOS apps launched from Finder inherit a bare PATH (/usr/bin:/bin:…), so
 *    Homebrew/nvm node is invisible and spawn('node') fails with ENOENT;
 *  - the bundled servers live inside app.asar, which a real node cannot read
 *    ("Cannot find module …/app.asar/node_modules/…"), so the child dies and the
 *    LSP connection is disposed mid-initialize.
 *
 * Spawning process.execPath with ELECTRON_RUN_AS_NODE fixes both: the child is
 * Electron's own Node (always present, asar-aware) and forks it starts itself —
 * tsserver, most importantly — inherit the flag.
 */

import path from 'node:path';

/** Command heads that mean "run this script with Node". */
const NODE_COMMAND_TOKENS = new Set(['node', 'node.exe', 'nodejs']);

/**
 * @param {unknown} bin
 * @returns {boolean}
 */
export function isNodeCommandToken(bin) {
  return typeof bin === 'string' && NODE_COMMAND_TOKENS.has(bin.toLowerCase());
}

/** True when the Minnow server itself is running inside Electron. */
export function isElectronRuntime() {
  const version = process.versions?.electron;
  return typeof version === 'string' && version !== '';
}

/** Executable that runs Node-based language servers (node in dev, Electron when packaged). */
export function getLspNodeExecutable() {
  return process.execPath;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** True when this argv head is the Electron binary standing in for node. */
export function isElectronNodeExecutable(bin) {
  return isElectronRuntime() && typeof bin === 'string' && samePath(bin, process.execPath);
}

/**
 * Add ELECTRON_RUN_AS_NODE when the spawned binary is Electron itself.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} bin - argv[0] about to be spawned
 * @returns {NodeJS.ProcessEnv}
 */
export function applyNodeRuntimeEnv(env, bin) {
  if (!isElectronNodeExecutable(bin)) {
    return env;
  }
  return { ...env, ELECTRON_RUN_AS_NODE: '1' };
}
