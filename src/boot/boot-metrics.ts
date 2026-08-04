/**
 * Boot timing — time from earliest HTML parse stamp to shell-ready (loader dismissed),
 * plus named phase marks for DevTools traces when MINNOW_DEBUG=1.
 */

declare global {
  interface Window {
    /** Set inline in index.html before the module bundle loads. */
    __MINNOW_BOOT_ORIGIN_MS?: number;
    /** Latest boot metrics snapshot for Settings / CI probes. */
    __MINNOW_BOOT_METRICS__?: BootMetricsSnapshot;
  }
}

/** Named boot phases stamped via performance.mark('minnow:boot:' + phase). */
export type BootPhase =
  | 'shell-ready'
  | 'sessions'
  | 'config'
  | 'ui-init'
  | 'first-paint'
  | 'interactive';

export type BootMetricsSnapshot = {
  /** Ms from boot origin to markAppReady(). */
  appReadyMs: number;
  /** performance.now() when app-ready fired. */
  appReadyAtMs: number;
  /** Same origin stamp used for the delta (may differ from appReadyAtMs - appReadyMs). */
  bootOriginMs: number;
  /** Ms from boot origin to interactive (initApp exit); set when that phase is marked. */
  interactiveMs?: number;
};

const BOOT_MARK_PREFIX = 'minnow:boot:';

let latestSnapshot: BootMetricsSnapshot | null = null;

/** Read the inline HTML boot origin or fall back to the current clock. */
export function readBootOriginMs(nowMs: number = performance.now()): number {
  if (typeof window !== 'undefined' && typeof window.__MINNOW_BOOT_ORIGIN_MS === 'number') {
    return window.__MINNOW_BOOT_ORIGIN_MS;
  }
  return nowMs;
}

/** performance.mark name for a boot phase. */
export function bootPhaseMarkName(phase: BootPhase): string {
  return `${BOOT_MARK_PREFIX}${phase}`;
}

/** Stamp a boot phase with the real Performance Timeline API (visible in DevTools). */
export function markBootPhase(phase: BootPhase): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  try {
    performance.mark(bootPhaseMarkName(phase));
  } catch {
    /* mark may throw if the name collides in some environments */
  }

  // interactiveMs is the number the app previously lacked — record when init finishes.
  if (phase === 'interactive') {
    const nowMs = performance.now();
    const bootOriginMs = readBootOriginMs(nowMs);
    const interactiveMs = Math.max(0, nowMs - bootOriginMs);
    if (latestSnapshot) {
      latestSnapshot = { ...latestSnapshot, interactiveMs };
    } else {
      latestSnapshot = {
        bootOriginMs,
        appReadyAtMs: nowMs,
        appReadyMs: interactiveMs,
        interactiveMs,
      };
    }
    if (typeof window !== 'undefined') {
      window.__MINNOW_BOOT_METRICS__ = latestSnapshot;
    }
  }
}

/** Measure the span between two previously stamped boot phases. */
export function measureBootPhase(name: string, from: BootPhase, to: BootPhase): void {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  try {
    performance.measure(name, bootPhaseMarkName(from), bootPhaseMarkName(to));
  } catch {
    /* missing marks — skip quietly */
  }
}

/** Record shell-ready timing and expose it on window for diagnostics. */
export function recordAppReadyMetrics(nowMs: number = performance.now()): BootMetricsSnapshot {
  const bootOriginMs = readBootOriginMs(nowMs);
  const snapshot: BootMetricsSnapshot = {
    bootOriginMs,
    appReadyAtMs: nowMs,
    appReadyMs: Math.max(0, nowMs - bootOriginMs),
    interactiveMs: latestSnapshot?.interactiveMs,
  };
  latestSnapshot = snapshot;
  if (typeof window !== 'undefined') {
    window.__MINNOW_BOOT_METRICS__ = snapshot;
  }
  markBootPhase('shell-ready');
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
  if (typeof performance !== 'undefined' && typeof performance.clearMarks === 'function') {
    try {
      for (const phase of [
        'shell-ready',
        'sessions',
        'config',
        'ui-init',
        'first-paint',
        'interactive',
      ] as BootPhase[]) {
        performance.clearMarks(bootPhaseMarkName(phase));
      }
    } catch {
      /* ignore */
    }
  }
}

/** Collect boot-related performance.measure entries for the debug phase table. */
function collectBootMeasures(): PerformanceEntry[] {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return [];
  }
  return performance
    .getEntriesByType('measure')
    .filter((e) => e.name.startsWith('minnow:boot:') || e.name.startsWith('minnow:phase:'));
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
  if (typeof snapshot.interactiveMs === 'number') {
    console.info(`[minnow:boot] interactive in ${snapshot.interactiveMs.toFixed(1)} ms`);
  }
}

/** Print a phase table once interactive is reached (MINNOW_DEBUG / Vite DEV). */
export function logBootPhaseTableIfDebug(): void {
  const env = import.meta.env;
  const debug =
    env?.DEV === true ||
    env?.MINNOW_DEBUG === '1' ||
    env?.MINNOW_DEBUG === 'true';
  if (!debug) return;

  const snapshot = latestSnapshot;
  const rows: { phase: string; ms: string }[] = [];
  if (snapshot) {
    rows.push({ phase: 'shell-ready', ms: snapshot.appReadyMs.toFixed(1) });
    if (typeof snapshot.interactiveMs === 'number') {
      rows.push({ phase: 'interactive', ms: snapshot.interactiveMs.toFixed(1) });
    }
  }

  const measures = collectBootMeasures();
  for (const entry of measures) {
    rows.push({ phase: entry.name, ms: entry.duration.toFixed(1) });
  }

  if (rows.length === 0) {
    console.info('[minnow:boot] phase table: (no marks yet)');
    return;
  }
  console.info('[minnow:boot] phase table');
  console.table(rows);
}
