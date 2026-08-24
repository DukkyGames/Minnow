/**
 * Pause decorative animation while nobody can see the window.
 *
 * The shell runs with `backgroundThrottling: false` so AFK boards, chat timers and SSE
 * delivery survive a sleeping display. The cost is that Chromium also stops throttling
 * the *compositor*: a caret blink or a spinner keeps producing a frame every vsync for a
 * window sitting in the tray. On a machine hosting a local model that is not free — the
 * GPU time-shares its 3D queue between the compositor and CUDA, so decode slows down.
 *
 * Setting `data-mn-render="idle"` on <html> parks every running animation and transition
 * (see `motion.css`). Timers, network and JS are untouched — this only stops painting.
 */

const IDLE_ATTR = 'data-mn-render';

let applied = false;

function setIdle(idle: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  if (idle) {
    root.setAttribute(IDLE_ATTR, 'idle');
  } else {
    root.removeAttribute(IDLE_ATTR);
  }
}

/** True while the window is hidden, minimised, or otherwise not being presented. */
export function isRenderIdle(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement?.getAttribute(IDLE_ATTR) === 'idle';
}

/**
 * Start tracking window visibility. Safe to call once at boot; later calls are no-ops.
 *
 * Two sources, because neither alone is reliable here: the Page Visibility API does not
 * fire for every Electron tray/minimise path once background throttling is off, and the
 * main-process events do not fire for display sleep or occlusion.
 */
export function initRenderIdleTracking(): () => void {
  if (applied || typeof document === 'undefined') return () => {};
  applied = true;

  const cleanups: Array<() => void> = [];

  const fromDocument = (): void => {
    if (document.visibilityState === 'hidden') setIdle(true);
    else setIdle(false);
  };
  document.addEventListener('visibilitychange', fromDocument);
  cleanups.push(() => document.removeEventListener('visibilitychange', fromDocument));
  fromDocument();

  const windowApi = window.minnow?.window;
  if (windowApi?.onVisibilityChanged) {
    // The main process is authoritative for tray-hide and minimise; a visible window
    // still defers to the document, which knows about occlusion and display sleep.
    cleanups.push(
      windowApi.onVisibilityChanged((visible) => {
        if (!visible) setIdle(true);
        else fromDocument();
      }),
    );
  }

  return () => {
    for (const fn of cleanups) fn();
    cleanups.length = 0;
    applied = false;
    setIdle(false);
  };
}
