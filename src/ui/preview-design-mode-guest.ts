/**
 * Electron preview guest visibility while Design Mode is active (MIN-365).
 *
 * WebContentsView paints above renderer DOM, so Design Mode hides the native guest and
 * drives a same-origin iframe under the SVG overlay. preview-panel.ts toggles this flag;
 * preview-electron-visibility.ts reads it without importing design-mode (avoids CSS/test churn).
 */

let designModeUsingIframeGuest = false;

/** True while workspace-preview Design Mode is using the iframe guest instead of WebContentsView. */
export function isDesignModeUsingIframeGuest(): boolean {
  return designModeUsingIframeGuest;
}

/** Called by preview-panel when Design Mode enables/disables the iframe guest swap. */
export function setDesignModeUsingIframeGuest(on: boolean): void {
  designModeUsingIframeGuest = on;
}

/** Test helper — reset between cases. */
export function resetDesignModeIframeGuestForTests(): void {
  designModeUsingIframeGuest = false;
}
