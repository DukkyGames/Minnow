/**
 * Lazy-load the engine controller host via the unified engine-module loader.
 * In dev/test (tsx hooks active): imports TS directly.
 * In packaged Electron: imports the pre-built engine-bundle.mjs.
 */

import { loadEngineModule, resetEngineModuleForTests } from './engine-module.js';

/** Reconcile registry + start watchdog once at engine boot. */
export async function bootEngineControllerOnStart() {
  const mod = await loadEngineModule();
  return /** @type {Function} */ (mod.bootEngineControllerOnStart)();
}

/** Activate host without waiting on a second boot latch (commands / spawn). */
export async function activateEngineControllerHost() {
  const mod = await loadEngineModule();
  return /** @type {Function} */ (mod.activateEngineControllerHost)();
}

/**
 * Apply a controller command (spawn_sub_agent / cancel_sub_agent).
 * @param {{ type: string, [key: string]: unknown }} cmd
 */
export async function applyControllerCommand(cmd) {
  const mod = await loadEngineModule();
  await /** @type {Function} */ (mod.activateEngineControllerHost)();
  return /** @type {Function} */ (mod.applyControllerSessionCommand)(cmd);
}

/** Clear cached module (tests). */
export function resetControllerLoaderForTests() {
  resetEngineModuleForTests();
}
