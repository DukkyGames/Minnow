/**
 * Browser (npm start) fallback preview host (MIN-364): one same-origin iframe per named
 * instance. preview-panel.ts keeps its own established per-tab iframe map for the default
 * 'workspace-preview' instance (unchanged, back-compat). This module is the reusable
 * counterpart for other named instances when no Electron WebContentsView bridge is available —
 * same "one guest surface per instance id" shape as the Electron instance registry in
 * electron/preview-instance-registry.ts, minus process isolation.
 */

const framesByInstance = new Map<string, HTMLIFrameElement>();

/** Get or create the same-origin iframe for a named instance, appended to `host`. */
export function getOrCreatePreviewIframe(instanceId: string, host: HTMLElement): HTMLIFrameElement {
  const existing = framesByInstance.get(instanceId);
  if (existing && host.contains(existing)) return existing;

  if (existing) existing.remove();

  const frame = document.createElement('iframe');
  frame.className = 'preview-frame';
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
  frame.title = `Preview: ${instanceId}`;
  host.appendChild(frame);
  framesByInstance.set(instanceId, frame);
  return frame;
}

/** Navigate a named instance's iframe to a same-origin URL. No-op if the instance has no iframe yet. */
export function loadPreviewIframeUrl(instanceId: string, url: string): void {
  const frame = framesByInstance.get(instanceId);
  if (!frame) return;
  frame.src = url;
}

/** Remove a named instance's iframe entirely (mirrors electron preview.instances.destroy). */
export function destroyPreviewIframe(instanceId: string): void {
  const frame = framesByInstance.get(instanceId);
  if (!frame) return;
  frame.remove();
  framesByInstance.delete(instanceId);
}

/** Test helper — clear all fallback iframes between cases. */
export function resetPreviewIframesForTests(): void {
  for (const frame of framesByInstance.values()) frame.remove();
  framesByInstance.clear();
}
