/**
 * Boot timing — time from earliest HTML parse stamp to shell-ready (loader dismissed).
 */

declare global {
  interface Window {
    /** Set inline in index.html before the module bundle loads. */
    __MINNOW_BOOT_ORIGIN_MS?: number;
    /** Latest boot metrics snapshot for Settings / CI probes. */
    __MINNOW_BOOT_METRICS__?: BootMetricsSnapshot;
  }
}

export type BootMetricsSnapshot = {
  /** Ms from boot origin to markAppReady(). */
  appReadyMs: number;
  /** performance.now() when app-ready fired. */
  appReadyAtMs: number;
  /** Same origin stamp used for the delta (may differ from appReadyAtMs - appReadyMs). */
  bootOriginMs: number;
};

let latestSnapshot: BootMetricsSnapshot | null = null;

/** Read the inline HTML boot origin or fall back to the current clock. */
export function readBootOriginMs(nowMs: number = performance.now()): number {
  if (typeof window !== 'undefined' && typeof window.__MINNOW_BOOT_ORIGIN_MS === 'number') {
    return window.__MINNOW_BOOT_ORIGIN_MS;
  }
  return nowMs;
}

/** Record shell-ready timing and expose it on window for diagnostics. */
export function recordAppReadyMetrics(nowMs: number = performance.now()): BootMetricsSnapshot {
  const bootOriginMs = readBootOriginMs(nowMs);
  const snapshot: BootMetricsSnapshot = {
    bootOriginMs,
    appReadyAtMs: nowMs,
    appReadyMs: Math.max(0, nowMs - bootOriginMs),
  };
  latestSnapshot = snapshot;
  if (typeof window !== 'undefined') {
    window.__MINNOW_BOOT_METRICS__ = snapshot;
  }
  return snapshot;
}

/** Last recorded app-ready snapshot (null before markAppReady). */
export function getBootMetrics(): BootMetricsSnapshot | null {
  return latestSnapshot;
}

/** Reset stored metrics (tests only). */
export function resetBootMetricsForTests(): void {
  latestSnapshot = null;
  if (typeof window !== 'undefined') {
    delete window.__MINNOW_BOOT_METRICS__;
    delete window.__MINNOW_BOOT_ORIGIN_MS;
  }
}

/** Dev-only console line when MINNOW_DEBUG=1 or Vite dev. */
export function logBootMetricsIfDebug(snapshot: BootMetricsSnapshot): void {
  const env = import.meta.env;
  const debug =
    env?.DEV === true ||
    env?.MINNOW_DEBUG === '1' ||
    env?.MINNOW_DEBUG === 'true';
  if (!debug) return;
  console.info(`[minnow:boot] shell ready in ${snapshot.appReadyMs.toFixed(1)} ms`);
}
