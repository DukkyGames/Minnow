/**
 * Lazy-load the engine main-chat loop via the unified engine-module loader.
 * In dev/test (tsx hooks active): imports TS directly.
 * In packaged Electron: imports the pre-built engine-bundle.mjs.
 */

import { loadEngineModule, resetEngineModuleForTests } from './engine-module.js';

/**
 * Run one engine-owned main-chat tool loop for a chat.
 * @param {any} options
 */
export async function runEngineMainChatTurn(options) {
  const mod = await loadEngineModule();
  return /** @type {Function} */ (mod.runEngineMainChatTurn)(options);
}

/** Clear cached module (tests). */
export function resetLoopLoaderForTests() {
  resetEngineModuleForTests();
}
