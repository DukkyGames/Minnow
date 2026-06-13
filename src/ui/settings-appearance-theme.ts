/**
 * Settings → Appearance: palette presets (family + mode).
 */

import { appendThemeControls } from './settings-theme';

/** Mount preset theme family/mode controls. */
export function appendAppearanceThemePresets(mount: HTMLElement): void {
  appendThemeControls(mount);
}
