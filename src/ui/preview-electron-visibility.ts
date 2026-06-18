/**
 * When the Electron WebContentsView preview host may be shown.
 * The native view is a window overlay — hide it unless the preview pane is open and unobstructed.
 * Show + setBounds must run in one pass so PREVIEW_SET_BOUNDS is not dropped while visible=false.
 */

import { getFilePanelState } from '../state/file-panel';

const FULLSCREEN_OVERLAY_IDS = [
  'globalBugsView',
  'settingsView',
  'benchmarkView',
  'expertsView',
  'researchView',
  'chatView',
] as const;

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

/** Position the native guest over #previewBody (no-op when the bridge is absent). */
async function applyElectronPreviewBounds(): Promise<void> {
  const api = window.minnow?.preview;
  const body = document.getElementById('previewBody');
  if (!api || !body) return;
  const rect = body.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  await api.setBounds({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

/**
 * Show or hide the native preview host and sync bounds when visible.
 * Call after layout changes (Code foreground, split restore, resize).
 */
export async function syncElectronPreviewHostLayout(): Promise<void> {
  const api = window.minnow?.preview;
  if (!api) return;

  if (!usesElectronPreview() || !isPreviewPaneDomVisible() || isFullscreenOverlayObscuringWorkspace()) {
    await api.hide();
    return;
  }

  if (!previewBodyHasLayout()) {
    await api.hide();
    return;
  }

  await api.show();
  await applyElectronPreviewBounds();
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
