/**
 * Engine module loader — selects tsx or bundle load path once per process.
 *
 * Mode priority (MIN-354 Stage 3):
 *  1. MINNOW_ENGINE_MODULE env override ('tsx' | 'bundle') — hard-fail if that
 *     mode cannot load.
 *  2. tsx active in this process — see {@link isTsxActive} (hook globals, or a
 *     `tsx` entry in execArgv/NODE_OPTIONS). Live sources always beat a bundle.
 *  3. Bundle file present at server/session/engine-bundle/engine-bundle.mjs.
 *  4. Unavailable.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Absolute path to the pre-built ESM bundle (output of build-engine-bundle.mjs). */
export const ENGINE_BUNDLE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'engine-bundle',
  'engine-bundle.mjs',
);

/**
 * @typedef {'tsx' | 'bundle' | 'unavailable'} EngineModuleMode
 * @typedef {{ available: boolean; mode: EngineModuleMode; reason: string }} EngineAvailability
 */

/**
 * Memoised namespace (set after first successful loadEngineModule()).
 * @type {Record<string, unknown> | null}
 */
let cachedModule = null;

/**
 * Memoised availability — evaluated once per process.
 * @type {EngineAvailability | null}
 */
let cachedAvailability = null;

export class EngineUnavailableError extends Error {
  /**
   * @param {string} message
   * @param {string} [reason]
   */
  constructor(message, reason) {
    super(message);
    this.name = 'EngineUnavailableError';
    this.code = 'ENGINE_UNAVAILABLE';
    this.reason = reason ?? 'unknown';
  }
}

/**
 * Whether this process can import `.ts` directly.
 *
 * The hook globals cover `npm start` / `electron:dev` (engine-tsx-hooks.mjs) and
 * the tsx-mocks-loader test runner (test-loader.mjs). The execArgv/NODE_OPTIONS
 * scan additionally covers the `tsx-mocks` and `node-tsx` runners, which load
 * tsx via `--import tsx` without either loader — without it those runners would
 * silently fall through to a stale pre-built bundle instead of live sources.
 *
 * Deliberately NOT keyed on MINNOW_TEST: that is an env var any process can set,
 * and claiming tsx when tsx is absent turns a clean bundle load into a hard
 * ERR_UNKNOWN_FILE_EXTENSION.
 * @returns {boolean}
 */
function isTsxActive() {
  if (globalThis.__MINNOW_ENGINE_TSX_HOOKS_REGISTERED === true) return true;
  if (globalThis.__MINNOW_TEST_LOADER_REGISTERED === true) return true;
  const flags = `${process.execArgv.join(' ')} ${process.env.NODE_OPTIONS ?? ''}`;
  return /(^|[\s=/\\])tsx($|[\s/\\])/.test(flags);
}

/**
 * Determine which mode is possible in this process (does NOT import anything).
 * Idempotent — result is cached after the first call.
 * @returns {EngineAvailability}
 */
export function describeEngineAvailability() {
  if (cachedAvailability) return cachedAvailability;

  const override = process.env.MINNOW_ENGINE_MODULE;
  if (override === 'tsx') {
    cachedAvailability = { available: true, mode: 'tsx', reason: 'env-override' };
    return cachedAvailability;
  }
  if (override === 'bundle') {
    const bundleExists = fs.existsSync(ENGINE_BUNDLE_PATH);
    if (bundleExists) {
      cachedAvailability = { available: true, mode: 'bundle', reason: 'env-override' };
    } else {
      cachedAvailability = {
        available: false,
        mode: 'unavailable',
        reason: 'env-override-bundle-missing',
      };
    }
    return cachedAvailability;
  }
  if (override && override !== 'tsx' && override !== 'bundle') {
    cachedAvailability = {
      available: false,
      mode: 'unavailable',
      reason: `invalid-MINNOW_ENGINE_MODULE-value:${override}`,
    };
    return cachedAvailability;
  }

  if (isTsxActive()) {
    cachedAvailability = { available: true, mode: 'tsx', reason: 'tsx-active' };
    return cachedAvailability;
  }

  if (fs.existsSync(ENGINE_BUNDLE_PATH)) {
    cachedAvailability = { available: true, mode: 'bundle', reason: 'bundle-file-present' };
    return cachedAvailability;
  }

  cachedAvailability = {
    available: false,
    mode: 'unavailable',
    reason: 'no-tsx-hooks-and-no-bundle',
  };
  return cachedAvailability;
}

/**
 * Return the current mode string.
 * @returns {EngineModuleMode}
 */
export function getEngineModuleMode() {
  return describeEngineAvailability().mode;
}

/**
 * Build the tsx-mode namespace with the same shape as the bundle entry.
 * Individual .ts modules are imported lazily — only called when tsx hooks are active.
 * @returns {Promise<Record<string, unknown>>}
 */
async function buildTsxNamespace() {
  const [mainLoop, boardHost, boardCmds, controllerHost, controllerCmds, askQ, buildMsgs, sessions] =
    await Promise.all([
      import('../../src/session-engine/main-chat-loop.ts'),
      import('../../src/session-engine/board-host.ts'),
      import('../../src/session-engine/board-commands.ts'),
      import('../../src/session-engine/controller-host.ts'),
      import('../../src/session-engine/controller-commands.ts'),
      import('../../src/session-engine/ask-question-bridge.ts'),
      import('../../src/session-engine/build-api-messages.ts'),
      import('../../src/state/sessions.ts'),
    ]);

  return {
    runEngineMainChatTurn: mainLoop.runEngineMainChatTurn,
    resumeEngineBoardsOnBoot: boardHost.resumeEngineBoardsOnBoot,
    rebindEngineBoardHostSession: boardHost.rebindEngineBoardHostSession,
    activateEngineBoardHost: boardHost.activateEngineBoardHost,
    deactivateEngineBoardHost: boardHost.deactivateEngineBoardHost,
    isEngineBoardHostActive: boardHost.isEngineBoardHostActive,
    applyBoardCommand: boardCmds.applyBoardCommand,
    bootEngineControllerOnStart: controllerHost.bootEngineControllerOnStart,
    activateEngineControllerHost: controllerHost.activateEngineControllerHost,
    applyControllerSessionCommand: controllerCmds.applyControllerSessionCommand,
    parkAskQuestion: askQ.parkAskQuestion,
    cancelParkedAskQuestion: askQ.cancelParkedAskQuestion,
    resolveParkedAskQuestion: askQ.resolveParkedAskQuestion,
    buildEngineApiMessages: buildMsgs.buildEngineApiMessages,
    buildEngineHistoryUserContent: buildMsgs.buildEngineHistoryUserContent,
    setSessionStateForEngineHost: sessions.setSessionStateForEngineHost,
  };
}

/**
 * Load and memoise the engine namespace for the selected mode.
 * Throws EngineUnavailableError when mode is 'unavailable'.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadEngineModule() {
  if (cachedModule) return cachedModule;

  const avail = describeEngineAvailability();
  if (!avail.available) {
    throw new EngineUnavailableError(
      `Session Engine module unavailable: ${avail.reason}`,
      avail.reason,
    );
  }

  if (avail.mode === 'tsx') {
    cachedModule = await buildTsxNamespace();
    return cachedModule;
  }

  // Bundle mode — dynamic import of the pre-built .mjs file.
  const { pathToFileURL } = await import('node:url');
  cachedModule = /** @type {Record<string, unknown>} */ (
    await import(pathToFileURL(ENGINE_BUNDLE_PATH).href)
  );
  return cachedModule;
}

/**
 * The already-loaded namespace, or null. Never triggers a load.
 *
 * For best-effort callers that must not pay for importing the whole engine
 * graph (tsx) or the 6 MB bundle just to discover there is nothing to do —
 * e.g. the board-host rebind that runs on every mutateEngineState.
 * @returns {Record<string, unknown> | null}
 */
export function peekEngineModule() {
  return cachedModule;
}

/**
 * Convenience: set engine host session state without knowing the load path.
 * @param {unknown} state
 */
export async function setEngineHostSessionState(state) {
  const mod = await loadEngineModule();
  const fn = /** @type {(s: unknown) => void} */ (mod.setSessionStateForEngineHost);
  if (typeof fn !== 'function') {
    throw new Error('Engine module missing setSessionStateForEngineHost');
  }
  fn(state);
}

/** Reset memoised state (tests). */
export function resetEngineModuleForTests() {
  cachedModule = null;
  cachedAvailability = null;
}
