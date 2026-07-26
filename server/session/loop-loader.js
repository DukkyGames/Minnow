/**
 * Lazy-load the TypeScript main-chat loop via tsx (same precedent as headless CLI).
 * Keeps one source of truth under src/session-engine/ without compiling for the server.
 */

/** @type {typeof import('../../src/session-engine/main-chat-loop.ts') | null} */
let cached = null;

/**
 * @returns {Promise<typeof import('../../src/session-engine/main-chat-loop.ts')>}
 */
async function loadMainChatLoopModule() {
  if (cached) return cached;
  const { tsImport } = await import('tsx/esm/api');
  cached = await tsImport('../../src/session-engine/main-chat-loop.ts', import.meta.url);
  return cached;
}

/**
 * Run one engine-owned main-chat tool loop for a chat.
 * @param {import('../../src/session-engine/main-chat-loop.ts').EngineMainChatTurnOptions} options
 */
export async function runEngineMainChatTurn(options) {
  const mod = await loadMainChatLoopModule();
  return mod.runEngineMainChatTurn(options);
}

/** Clear cached module (tests). */
export function resetLoopLoaderForTests() {
  cached = null;
}
