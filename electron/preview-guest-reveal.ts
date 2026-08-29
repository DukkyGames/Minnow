/**
 * Main-process paint policy for the preview WebContentsView.
 *
 * The native guest is a window-level overlay. Renderer `preview.show(bounds)` is the
 * only path that may turn a hidden guest on. Activate / navigate / load must attach
 * the guest for background loads without restoring lastBounds and calling setVisible(true).
 */

/** Attach the guest for navigation; paint only when the renderer has explicitly shown it. */
export type PreviewGuestAttachMode = 'paint' | 'navigate-hidden';

/**
 * Decide whether activate/navigate may paint the guest.
 * Explicit valid bounds come from renderer show(bounds). lastBounds reuse is allowed
 * only while the instance is already visible (tab switch in an open pane).
 */
export function resolvePreviewGuestAttachMode(options: {
  explicitBoundsValid: boolean;
  instanceAlreadyVisible: boolean;
}): PreviewGuestAttachMode {
  if (options.explicitBoundsValid || options.instanceAlreadyVisible) return 'paint';
  return 'navigate-hidden';
}

/**
 * Capture may briefly restore bounds to get pixels. Afterward, hide unless the
 * guest was already visible (renderer-gated). Avoids an orphan overlay after screenshots.
 */
export function shouldKeepPreviewGuestVisibleAfterCapture(wasVisibleBeforeCapture: boolean): boolean {
  return wasVisibleBeforeCapture;
}
