/**
 * Electron preview guest visibility while Design Mode is active (MIN-365).
 *
 * WebContentsView paints above renderer DOM, so Design Mode hides the native guest and
 * drives a same-origin iframe under the SVG overlay. Tracked per preview instance so a
 * split secondary browser can use Design Mode independently of the primary pane.
 */

import { WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID } from './preview-design-mode-mount';

const iframeGuestInstances = new Set<string>();

/** True while the given preview instance uses the iframe guest instead of WebContentsView. */
export function isDesignModeUsingIframeGuest(
  instanceId: string = WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID,
): boolean {
  return iframeGuestInstances.has(instanceId);
}

/** Called when Design Mode enables/disables the iframe guest swap for one preview instance. */
export function setDesignModeUsingIframeGuest(instanceId: string, on: boolean): void {
  if (on) iframeGuestInstances.add(instanceId);
  else iframeGuestInstances.delete(instanceId);
}

/** Test helper — reset between cases. */
export function resetDesignModeIframeGuestForTests(): void {
  iframeGuestInstances.clear();
}
