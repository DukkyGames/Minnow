/**
 * Lazy-load the TypeScript main-chat loop (same precedent as board-loader).
 * Process must be started with engine-tsx-hooks + tsx (package.json start).
 */

/** @type {typeof import('../../src/session-engine/main-chat-loop.ts') | null} */
let cached = null;

/**
 * @returns {Promise<typeof import('../../src/session-engine/main-chat-loop.ts')>}
 */
async function loadMainChatLoopModule() {
  if (cached) return cached;
  cached = await import('../../src/session-engine/main-chat-loop.ts');
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
