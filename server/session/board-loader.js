/**
 * Lazy-load the engine board host and commands via the unified engine-module loader.
 * In dev/test (tsx hooks active): imports TS directly.
 * In packaged Electron: imports the pre-built engine-bundle.mjs.
 */

import { loadEngineModule, resetEngineModuleForTests } from './engine-module.js';

/** Activate board host + resume autoRunning boards after server boot. */
export async function resumeEngineBoardsOnBoot() {
  const mod = await loadEngineModule();
  return /** @type {Function} */ (mod.resumeEngineBoardsOnBoot)();
}

/**
 * Re-bind sessionState alias after engineState replace.
 * Guard: if engine module not yet loaded, skip (rebind is best-effort).
 */
export async function rebindEngineBoardHostSession() {
  let mod;
  try {
    mod = await loadEngineModule();
  } catch {
    return; // engine unavailable — board host not active, nothing to rebind
  }
  const fn = mod.rebindEngineBoardHostSession;
  if (typeof fn === 'function') {
    /** @type {Function} */ (fn)();
  }
}

/**
 * Apply a board command (board_start, board_stop, …).
 * @param {any} cmd
 */
export async function applyBoardCommand(cmd) {
  const mod = await loadEngineModule();
  return /** @type {Function} */ (mod.applyBoardCommand)(cmd);
}

/** Clear cached module (tests). */
export function resetBoardLoaderForTests() {
  resetEngineModuleForTests();
}
