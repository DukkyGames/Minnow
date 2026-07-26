/**
 * Lazy-load the engine board host and commands via the unified engine-module loader.
 * In dev/test (tsx hooks active): imports TS directly.
 * In packaged Electron: imports the pre-built engine-bundle.mjs.
 */

import {
  loadEngineModule,
  peekEngineModule,
  resetEngineModuleForTests,
} from './engine-module.js';

/** Activate board host + resume autoRunning boards after server boot. */
export async function resumeEngineBoardsOnBoot() {
  const mod = await loadEngineModule();
  return /** @type {Function} */ (mod.resumeEngineBoardsOnBoot)();
}

/**
 * Re-bind sessionState alias after engineState replace.
 *
 * Runs on every mutateEngineState, so it must never *trigger* a load: if the
 * engine module has not been imported yet there is no board host holding a
 * stale alias, and forcing the import here would pay for the whole TS graph
 * (dev) or the 6 MB bundle (packaged) on an ordinary state write.
 */
export function rebindEngineBoardHostSession() {
  const mod = peekEngineModule();
  if (!mod) return; // engine not loaded — no board host alias to rebind
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
