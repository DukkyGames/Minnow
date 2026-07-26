/**
 * Lazy-load the TypeScript board host (MIN-360 Phase 2).
 *
 * Requires the process to be started with:
 *   --import ./server/session/engine-tsx-hooks.mjs --import tsx
 * (wired in package.json `start` / electron:dev). Tests use test-loader + tsx.
 */

/** @type {typeof import('../../src/session-engine/board-host.ts') | null} */
let hostCached = null;

/** @type {typeof import('../../src/session-engine/board-commands.ts') | null} */
let commandsCached = null;

/**
 * @returns {Promise<typeof import('../../src/session-engine/board-host.ts')>}
 */
async function loadBoardHostModule() {
  if (hostCached) return hostCached;
  hostCached = await import('../../src/session-engine/board-host.ts');
  return hostCached;
}

/**
 * @returns {Promise<typeof import('../../src/session-engine/board-commands.ts')>}
 */
async function loadBoardCommandsModule() {
  if (commandsCached) return commandsCached;
  commandsCached = await import('../../src/session-engine/board-commands.ts');
  return commandsCached;
}

/** Activate board host + resume autoRunning boards after server boot. */
export async function resumeEngineBoardsOnBoot() {
  const mod = await loadBoardHostModule();
  return mod.resumeEngineBoardsOnBoot();
}

/** Re-bind sessionState alias after engineState replace. */
export async function rebindEngineBoardHostSession() {
  if (!hostCached) return;
  hostCached.rebindEngineBoardHostSession();
}

/**
 * Apply a board command (board_start, board_stop, …).
 * @param {import('../../src/session-engine/board-commands.ts').BoardCommand} cmd
 */
export async function applyBoardCommand(cmd) {
  const mod = await loadBoardCommandsModule();
  return mod.applyBoardCommand(cmd);
}

/** Clear cached modules (tests). */
export function resetBoardLoaderForTests() {
  hostCached = null;
  commandsCached = null;
}
