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
