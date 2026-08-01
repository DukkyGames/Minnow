/**
 * Dev-only PerformanceObserver for main-thread long tasks (100ms+).
 * Enabled when MINNOW_DEBUG=1 (or Vite dev with the same flag).
 */

const LONG_TASK_THRESHOLD_MS = 100;

let observer: PerformanceObserver | null = null;

function isLongTaskDebugEnabled(): boolean {
  const env = import.meta.env;
  return env?.MINNOW_DEBUG === '1' || env?.MINNOW_DEBUG === 'true';
}

/** Start observing long tasks when debug mode is on. */
export function installLongTaskObserver(): void {
  const env = import.meta.env;
  if (env?.DEV !== true && !isLongTaskDebugEnabled()) return;
  if (!isLongTaskDebugEnabled()) return;
  if (typeof PerformanceObserver === 'undefined') return;
  if (observer) return;

  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONG_TASK_THRESHOLD_MS) continue;
        console.warn(
          `[minnow:longtask] ${entry.duration.toFixed(1)} ms`,
          entry.name || 'longtask',
        );
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    /* longtask unsupported in this environment */
  }
}

/** Disconnect observer (tests only). */
export function disconnectLongTaskObserverForTests(): void {
  observer?.disconnect();
  observer = null;
}
