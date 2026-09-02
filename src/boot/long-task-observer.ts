/**
 * Dev-only PerformanceObserver for main-thread long tasks (100ms+).
 * Enabled when MINNOW_DEBUG=1 (or Vite dev with the same flag).
 * Correlates each long task with overlapping performance.measure entries (boot phases).
 */

const LONG_TASK_THRESHOLD_MS = 100;

let observer: PerformanceObserver | null = null;

function isLongTaskDebugEnabled(): boolean {
  const env = import.meta.env;
  return env?.MINNOW_DEBUG === '1' || env?.MINNOW_DEBUG === 'true';
}

/** Find measure entries whose time range overlaps a long-task entry. */
function overlappingMeasures(entry: PerformanceEntry): string[] {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return [];
  }
  const taskStart = entry.startTime;
  const taskEnd = entry.startTime + entry.duration;
  const names: string[] = [];
  for (const measure of performance.getEntriesByType('measure')) {
    const mStart = measure.startTime;
    const mEnd = measure.startTime + measure.duration;
    if (mEnd < taskStart || mStart > taskEnd) continue;
    names.push(measure.name);
  }
  return names;
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
        const enclosing = overlappingMeasures(entry);
        const phaseSuffix =
          enclosing.length > 0 ? ` phase=[${enclosing.join(', ')}]` : ' phase=(none)';
        console.warn(
          `[minnow:longtask] ${entry.duration.toFixed(1)} ms`,
          entry.name || 'longtask',
          phaseSuffix,
        );
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {}
}

/** Disconnect observer (tests only). */
export function disconnectLongTaskObserverForTests(): void {
  observer?.disconnect();
  observer = null;
}
