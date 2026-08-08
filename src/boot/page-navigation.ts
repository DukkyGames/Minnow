/**
 * Distinguish a full page reload from a cold navigation (app/window launch).
 */

/** True when this document load was triggered by reload (F5, Ctrl+R, etc.). */
export function isPageReload(): boolean {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return false;
  }
  const entry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  return entry?.type === 'reload';
}
