/**
 * When the Electron WebContentsView preview host may be shown.
 * The native view is a window overlay — hide it unless the preview pane is open and unobstructed.
 * Show + setBounds must run in one pass so PREVIEW_SET_BOUNDS is not dropped while visible=false.
 */

import type { MinnowPreviewBounds } from '../electron';
import { getFilePanelState } from '../state/file-panel';

const FULLSCREEN_OVERLAY_IDS = [
  'globalBugsView',
  'settingsView',
  'benchmarkView',
  'expertsView',
  'researchView',
  'chatView',
] as const;

const MAX_LAYOUT_STABLE_FRAMES = 6;

function usesElectronPreview(): boolean {
  return Boolean(window.minnow?.preview);
}

/** True when a full-screen route covers the workspace (bugs, settings, etc.). */
export function isFullscreenOverlayObscuringWorkspace(): boolean {
  for (const id of FULLSCREEN_OVERLAY_IDS) {
    const el = document.getElementById(id);
    if (el?.classList.contains('is-open')) return true;
  }
  return false;
}

/** Open menubar/chrome popovers that overlap the preview pane (native layer wins). */
let chromePopoverOpenCount = 0;

/** Register an obstructing chrome popover (notifications, model chip, workspace, etc.). */
export function registerChromePopover(): void {
  chromePopoverOpenCount += 1;
  scheduleElectronPreviewHostVisibilitySync();
}

/** Unregister when a chrome popover closes. */
export function unregisterChromePopover(): void {
  if (chromePopoverOpenCount > 0) chromePopoverOpenCount -= 1;
  scheduleElectronPreviewHostVisibilitySync();
}

/** True while any registered chrome popover is open. */
export function isChromePopoverOpen(): boolean {
  return chromePopoverOpenCount > 0;
}

/** Test helper — reset popover registry between cases. */
export function resetChromePopoverRegistryForTests(): void {
  chromePopoverOpenCount = 0;
}

/** True when the preview split pane is the active right pane and not CSS-hidden. */
export function isPreviewPaneDomVisible(): boolean {
  if (getFilePanelState().rightPaneMode !== 'preview') return false;
  const pane = document.getElementById('previewPane');
  if (!pane || pane.classList.contains('hidden')) return false;
  return true;
}

/** Whether the Chromium guest should be visible and receive bounds updates. */
export function shouldShowElectronPreviewHost(): boolean {
  if (!usesElectronPreview()) return false;
  if (!isPreviewPaneDomVisible()) return false;
  if (isFullscreenOverlayObscuringWorkspace()) return false;
  if (isChromePopoverOpen()) return false;
  const body = document.getElementById('previewBody');
  if (!body) return false;
  const rect = body.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function previewBodyHasLayout(): boolean {
  const body = document.getElementById('previewBody');
  if (!body) return false;
  const rect = body.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function readPreviewBodyBounds(): MinnowPreviewBounds | null {
  const body = document.getElementById('previewBody');
  if (!body) return null;
  const rect = body.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function rectsStable(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/** Wait until #previewBody has non-zero size and its rect stops moving between frames. */
function waitForStablePreviewBodyBounds(): Promise<MinnowPreviewBounds | null> {
  return new Promise((resolve) => {
    let frames = 0;
    let previous: DOMRect | null = null;

    const tick = (): void => {
      const body = document.getElementById('previewBody');
      if (!body) {
        resolve(null);
        return;
      }

      const rect = body.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        frames += 1;
        if (frames >= MAX_LAYOUT_STABLE_FRAMES) {
          resolve(null);
          return;
        }
        requestAnimationFrame(tick);
        return;
      }

      if (previous && rectsStable(previous, rect)) {
        resolve(readPreviewBodyBounds());
        return;
      }

      previous = rect;
      frames += 1;
      if (frames >= MAX_LAYOUT_STABLE_FRAMES) {
        resolve(readPreviewBodyBounds());
        return;
      }
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}

/** Serialize layout sync so overlapping async IPC cannot apply stale bounds. */
let layoutSyncChain: Promise<void> = Promise.resolve();
let previewGuestVisible = false;

async function runElectronPreviewHostLayoutSync(): Promise<void> {
  const api = window.minnow?.preview;
  if (!api) return;

  if (!shouldShowElectronPreviewHost()) {
    await api.hide();
    previewGuestVisible = false;
    return;
  }

  const bounds = await waitForStablePreviewBodyBounds();
  if (!bounds) return;

  if (!previewGuestVisible) {
    await api.show(bounds);
    previewGuestVisible = true;
    return;
  }

  await api.setBounds(bounds);
}

/**
 * Show or hide the native preview host and sync bounds when visible.
 * Call after layout changes (Code foreground, split restore, resize).
 */
export function syncElectronPreviewHostLayout(): Promise<void> {
  const next = layoutSyncChain.then(() => runElectronPreviewHostLayoutSync());
  layoutSyncChain = next.catch(() => {});
  return next;
}

/** @deprecated Use syncElectronPreviewHostLayout — kept for existing dynamic imports. */
export async function syncElectronPreviewHostVisibility(): Promise<void> {
  await syncElectronPreviewHostLayout();
}

let layoutSyncRaf = 0;
let layoutRetryFrames = 0;
const MAX_LAYOUT_RETRY_FRAMES = 8;

function scheduleLayoutRetryIfNeeded(): void {
  if (!usesElectronPreview()) return;
  if (!isPreviewPaneDomVisible() || isFullscreenOverlayObscuringWorkspace()) return;
  if (previewBodyHasLayout()) {
    layoutRetryFrames = 0;
    return;
  }
  if (layoutRetryFrames >= MAX_LAYOUT_RETRY_FRAMES) return;
  layoutRetryFrames += 1;
  requestAnimationFrame(() => {
    void syncElectronPreviewHostLayout().then(scheduleLayoutRetryIfNeeded);
  });
}

/** Debounced show/hide + bounds sync (resize, layout, overlay open, Code foreground). */
export function scheduleElectronPreviewHostVisibilitySync(): void {
  if (layoutSyncRaf) return;
  layoutSyncRaf = requestAnimationFrame(() => {
    layoutSyncRaf = 0;
    void syncElectronPreviewHostLayout().then(scheduleLayoutRetryIfNeeded);
  });
}

/** Alias for callers that distinguish visibility from bounds — same combined sync. */
export const scheduleElectronPreviewHostLayoutSync = scheduleElectronPreviewHostVisibilitySync;

/** Test helper — reset guest visibility tracking between cases. */
export function resetPreviewGuestVisibilityForTests(): void {
  previewGuestVisible = false;
  layoutSyncChain = Promise.resolve();
}
