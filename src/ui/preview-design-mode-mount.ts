/**
 * Design Mode mount targets for the workspace preview instance.
 * The overlay always mounts in `#previewBody`. The tool strip starts there too; Electron
 * reparents it to `#previewDesignChrome` only while the native WebContentsView is the guest
 * (cross-origin Select), via `syncDesignModeElectronGuest` in preview-panel.ts.
 */

import type { DesignModeMountOptions } from '../design/design-mode';

/** Default preview instance id (see electron/preview-instance-registry.ts). */
export const WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID = 'workspace-preview';

/** Resolve where Design Mode should mount overlay + tool strip for the workspace preview. */
export function resolveDesignModeMountOptions(
  host: HTMLElement,
  pane: HTMLElement | null,
  _chromeHost: HTMLElement | null,
  onExit?: () => void,
): DesignModeMountOptions {
  return {
    instanceId: WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID,
    host,
    paneElement: pane ?? host,
    onExit,
  };
}
