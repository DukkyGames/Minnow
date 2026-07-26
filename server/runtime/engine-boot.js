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

    const { ensureSessionEngineBooted } = await import('../session/engine.js');
    await ensureSessionEngineBooted();

    // Phase 3: controller registry + watchdog once per process (before board resume).
    const { bootEngineControllerOnStart } = await import('../session/controller-loader.js');
    await bootEngineControllerOnStart().catch((err) => {
      console.error('[session-engine] controller boot failed:', err);
    });

    // Phase 2: resume auto/AFK boards in-process (zero devices required).
    const { resumeEngineBoardsOnBoot } = await import('../session/board-loader.js');
    await resumeEngineBoardsOnBoot().catch((err) => {
      console.error('[session-engine] board boot resume failed:', err);
    });

    console.log(
      '[session-engine] ON — POST /api/session/commands + board + controller host',
    );
  })();

  return bootLatch;
}

/** Reset boot latch (tests only). */
export function resetEngineBootForTests() {
  bootLatch = null;
}
