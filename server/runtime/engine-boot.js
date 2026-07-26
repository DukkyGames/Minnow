/**
 * Session Engine boot helper — extracted from server.js so Electron's
 * in-process server host (electron/server-host.ts) can trigger the same
 * boot sequence without duplicating code.
 *
 * Intentionally does NOT include the scheduler/calendar/email loops —
 * those are only meaningful when running the full dev server (server.js).
 */

import { setSchedulerServerBaseUrl } from '../scheduler/server-base-url.js';

/** Module-level promise latch — idempotent boot across multiple callers. */
/** @type {Promise<void> | null} */
let bootLatch = null;

/**
 * Boot the Session Engine for the current process.
 * Idempotent: a second call returns the original promise.
 *
 * @param {{ baseUrl: string }} opts
 * @returns {Promise<void>}
 */
export async function bootSessionEngine({ baseUrl }) {
  if (bootLatch) return bootLatch;

  bootLatch = (async () => {
    // Scheduler base URL must be set before any session-engine tool runs a job.
    setSchedulerServerBaseUrl(baseUrl);

    const { isServerEngineEnabled } = await import('../session/flag.js');
    if (!isServerEngineEnabled()) {
      console.log(
        '[session-engine] OFF (MINNOW_SERVER_ENGINE=0) — emergency renderer driving',
      );
      return;
    }

    // No tsx hooks and no pre-built bundle: the loaders would throw
    // EngineUnavailableError on every command. Say so once, up front, and skip
    // the boot — /api/session/engine reports enabled:false so clients fall back.
    const { describeEngineAvailability } = await import('../session/engine-module.js');
    const availability = describeEngineAvailability();
    if (!availability.available) {
      console.error(
        `[session-engine] UNAVAILABLE (${availability.reason}) — clients fall back to renderer driving.` +
          ' Run `npm run build:engine-bundle` or start with tsx hooks.',
      );
      return;
    }

    const { ensureSessionEngineBooted } = await import('../session/engine.js');
    await ensureSessionEngineBooted();

    // Phase 3: controller registry + watchdog once per process (before board resume).
    let controllerOk = true;
    const { bootEngineControllerOnStart } = await import('../session/controller-loader.js');
    await bootEngineControllerOnStart().catch((err) => {
      controllerOk = false;
      console.error('[session-engine] controller boot failed:', err);
    });

    // Phase 2: resume auto/AFK boards in-process (zero devices required).
    let boardOk = true;
    const { resumeEngineBoardsOnBoot } = await import('../session/board-loader.js');
    await resumeEngineBoardsOnBoot().catch((err) => {
      boardOk = false;
      console.error('[session-engine] board boot resume failed:', err);
    });

    // Report what actually came up — an "ON" line after two failed hosts is a lie.
    const hosts = [
      controllerOk ? 'controller host' : 'controller host FAILED',
      boardOk ? 'board host' : 'board host FAILED',
    ].join(' + ');
    console.log(
      `[session-engine] ON (${availability.mode}) — POST /api/session/commands + ${hosts}`,
    );
  })();

  return bootLatch;
}

/** Reset boot latch (tests only). */
export function resetEngineBootForTests() {
  bootLatch = null;
}
