/**
 * Generic per-instance Electron preview host binding (MIN-364).
 *
 * The workspace right pane keeps using preview-electron-visibility.ts unchanged (it is
 * intimately tied to #previewBody / #previewPane / the Code workspace chrome and stays the
 * dedicated wiring for the default 'workspace-preview' instance). This module is the reusable
 * counterpart for *other* named instances (Design surface, future Studio live-component
 * frames): it binds an arbitrary named instance to an arbitrary host element and keeps the
 * native WebContentsView bounds in sync via ResizeObserver, mirroring the show/hide + bounds
 * contract every instance shares with window.minnow.preview.
 */

import { scheduleAnimationFrame } from '../lib/schedule-animation-frame';
import type { MinnowPreviewBounds } from '../electron';

export function usesElectronPreview(): boolean {
  return Boolean(window.minnow?.preview);
}

interface BoundInstance {
  element: HTMLElement;
  observer: ResizeObserver | null;
  visible: boolean;
}

const boundInstances = new Map<string, BoundInstance>();

function readElementBounds(element: HTMLElement): MinnowPreviewBounds | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function syncInstance(instanceId: string): void {
  const bound = boundInstances.get(instanceId);
  const api = window.minnow?.preview;
  if (!bound || !api) return;

  if (!bound.visible) {
    void api.hide(undefined, instanceId);
    return;
  }

  const bounds = readElementBounds(bound.element);
  if (!bounds) {
    void api.hide(undefined, instanceId);
    return;
  }
  void api.show(bounds, undefined, instanceId);
}

/**
 * Bind a named preview instance to a host DOM element. Creates the instance (main process) and
 * keeps its bounds in sync with the element via ResizeObserver until the returned cleanup is
 * called. No-op (returns a no-op cleanup) outside Electron or without ResizeObserver support —
 * callers should fall back to preview-iframe-fallback.ts in that case.
 */
export function bindPreviewInstanceToElement(instanceId: string, element: HTMLElement): () => void {
  unbindPreviewInstance(instanceId);

  if (!usesElectronPreview() || typeof ResizeObserver === 'undefined') {
    return () => {};
  }

  void window.minnow?.preview.instances.create(instanceId);

  const bound: BoundInstance = { element, observer: null, visible: true };
  boundInstances.set(instanceId, bound);

  const observer = new ResizeObserver(scheduleAnimationFrame(() => syncInstance(instanceId)));
  observer.observe(element);
  bound.observer = observer;

  syncInstance(instanceId);
  return () => unbindPreviewInstance(instanceId);
}

/** Show/hide a bound instance without unbinding it (e.g. a tab switch that hides its container). */
export function setPreviewInstanceVisible(instanceId: string, visible: boolean): void {
  const bound = boundInstances.get(instanceId);
  if (!bound) return;
  bound.visible = visible;
  syncInstance(instanceId);
}

/** Re-measure and re-apply bounds for a bound instance (e.g. after a manual layout change). */
export function syncPreviewInstanceBounds(instanceId: string): void {
  syncInstance(instanceId);
}

/** Detach a bound instance from its element and hide the native guest. Does not destroy tabs. */
export function unbindPreviewInstance(instanceId: string): void {
  const existing = boundInstances.get(instanceId);
  if (!existing) return;
  existing.observer?.disconnect();
  boundInstances.delete(instanceId);
  void window.minnow?.preview.hide(undefined, instanceId);
}

/** Test helper — clear all bound instances between cases. */
export function resetPreviewInstanceHostsForTests(): void {
  for (const bound of boundInstances.values()) {
    bound.observer?.disconnect();
  }
  boundInstances.clear();
}
