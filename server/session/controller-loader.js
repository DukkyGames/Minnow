/**
 * Lazy-load the TypeScript controller host (MIN-361 Phase 3).
 *
 * Requires the process to be started with:
 *   --import ./server/session/engine-tsx-hooks.mjs --import tsx
 */

/** @type {typeof import('../../src/session-engine/controller-host.ts') | null} */
let hostCached = null;

/**
 * @returns {Promise<typeof import('../../src/session-engine/controller-host.ts')>}
 */
async function loadControllerHostModule() {
  if (hostCached) return hostCached;
  hostCached = await import('../../src/session-engine/controller-host.ts');
  return hostCached;
}

/** Reconcile registry + start watchdog once at engine boot. */
export async function bootEngineControllerOnStart() {
  const mod = await loadControllerHostModule();
  return mod.bootEngineControllerOnStart();
}

/** Activate host without waiting on a second boot latch (commands / spawn). */
export async function activateEngineControllerHost() {
  const mod = await loadControllerHostModule();
  return mod.activateEngineControllerHost();
}

/**
 * Apply a controller command (spawn_sub_agent / cancel_sub_agent).
 * @param {{ type: string, [key: string]: unknown }} cmd
 */
export async function applyControllerCommand(cmd) {
  const mod = await loadControllerHostModule();
  await mod.activateEngineControllerHost();
  const { applyControllerSessionCommand } = await import(
    '../../src/session-engine/controller-commands.ts'
  );
  return applyControllerSessionCommand(cmd);
}

/** Clear cached modules (tests). */
export function resetControllerLoaderForTests() {
  hostCached = null;
}
