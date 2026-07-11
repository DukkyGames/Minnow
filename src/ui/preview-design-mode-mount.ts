/**
 * Design Mode mount targets for the workspace preview instance.
 * Electron keeps the tool strip in `#previewDesignChrome` (below the WebContentsView);
 * browser mode mounts the strip inside `#previewBody` so it is not hidden when the design
 * chrome footer stays collapsed.
 */

import type { DesignModeMountOptions } from '../design/design-mode';

/** Default preview instance id (see electron/preview-instance-registry.ts). */
export const WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID = 'workspace-preview';

function usesElectronPreview(): boolean {
  const w = typeof window !== 'undefined' ? window : globalThis;
  return Boolean((w as Window & typeof globalThis).minnow?.preview);
}

/** Resolve where Design Mode should mount overlay + tool strip for the workspace preview. */
export function resolveDesignModeMountOptions(
  host: HTMLElement,
  pane: HTMLElement | null,
  chromeHost: HTMLElement | null,
  onExit?: () => void,
): DesignModeMountOptions {
  return {
    instanceId: WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID,
    host,
    chromeHost: usesElectronPreview() ? (chromeHost ?? undefined) : undefined,
    paneElement: pane ?? host,
    onExit,
  };
}
