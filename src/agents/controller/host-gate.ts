/**
 * Tiny latch: which process owns the sub-agent controller (MIN-361 Phase 3).
 * Kept free of sessions/UI imports so controller.ts can gate auto-boot without cycles.
 */

/** True when this process is the Session Engine controller host. */
let engineOwnsController = false;

/** Engine controller-host claims sole registry + watchdog ownership. */
export function setEngineOwnsController(owns: boolean): void {
  engineOwnsController = owns;
}

/** True when the in-process registry/watchdog are authoritative here. */
export function isEngineControllerHostActive(): boolean {
  return engineOwnsController;
}

/**
 * True when this process should auto-start persistence + watchdog at module load.
 * - Engine host: started explicitly by controller-host (not module side-effect).
 * - Renderer with MINNOW_SERVER_ENGINE: never (engine owns).
 * - Flag off / tests: keep today's renderer (or test) auto-boot.
 */
export function shouldAutoStartControllerBoot(): boolean {
  if (engineOwnsController) return false;

  // Renderer injected flag — skip local watchdog/persistence.
  if (typeof window !== 'undefined' && window.__MINNOW_SERVER_ENGINE__ === true) {
    return false;
  }

  // Node engine process with flag on: wait for controller-host boot.
  // Tests keep auto-boot so existing controller suites stay unchanged.
  if (
    typeof process !== 'undefined' &&
    process.env.MINNOW_TEST !== '1' &&
    isServerEngineEnvEnabled()
  ) {
    return false;
  }

  return true;
}

/** True when the renderer should treat SessionState.liveSubAgentRuns as source of truth. */
export function shouldReadLiveSubAgentSlice(): boolean {
  if (engineOwnsController) return false;
  if (typeof window !== 'undefined' && window.__MINNOW_SERVER_ENGINE__ === true) {
    return true;
  }
  return false;
}

function isServerEngineEnvEnabled(): boolean {
  if (typeof process === 'undefined') return false;
  const raw = process.env.MINNOW_SERVER_ENGINE;
  if (raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
