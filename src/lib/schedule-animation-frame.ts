/**
 * Coalesce rapid calls into a single requestAnimationFrame callback.
 * Use for ResizeObserver handlers that read/write layout to avoid
 * "ResizeObserver loop completed with undelivered notifications".
 */
export function scheduleAnimationFrame(fn: () => void): () => void {
  let rafId = 0;
  return () => {
    // Tests and some Node loaders have no rAF; run the work immediately so
    // ResizeObserver handlers still fire instead of throwing.
    if (typeof requestAnimationFrame !== 'function') {
      fn();
      return;
    }
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      fn();
    });
  };
}
