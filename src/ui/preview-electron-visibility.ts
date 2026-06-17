/**
 * When the Electron WebContentsView preview host may be shown.
 * The native view is a window overlay — hide it unless the preview pane is open and unobstructed.
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

/** Show or hide the native preview host to match DOM visibility. */
export async function syncElectronPreviewHostVisibility(): Promise<void> {
  const api = window.minnow?.preview;
  if (!api) return;
  if (shouldShowElectronPreviewHost()) {
    await api.show();
  } else {
    await api.hide();
  }
}

let visibilityRaf = 0;

/** Debounced visibility sync (resize, layout, overlay open). */
export function scheduleElectronPreviewHostVisibilitySync(): void {
  if (visibilityRaf) return;
  const schedule = () => {
    visibilityRaf = 0;
    void syncElectronPreviewHostVisibility();
  };
  if (typeof requestAnimationFrame === 'function') {
    visibilityRaf = requestAnimationFrame(schedule);
  } else {
    schedule();
  }
}
