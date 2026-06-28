/**
 * Coalesce rapid calls into a single requestAnimationFrame callback.
 * Use for ResizeObserver handlers that read/write layout to avoid
 * "ResizeObserver loop completed with undelivered notifications".
 */
export function scheduleAnimationFrame(fn: () => void): () => void {
  let rafId = 0;
  return () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      fn();
    });
  };
}
