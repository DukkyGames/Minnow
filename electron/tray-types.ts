/**
 * Shared tray status + command types (main ↔ preload ↔ renderer).
 */

export interface TrayLoadedModelRow {
  id: string;
  label: string;
  source: 'lm-studio' | 'minnow-serve';
}

export interface TrayStatusSnapshot {
  runningAgentCount: number;
  loadedLocalModels: TrayLoadedModelRow[];
}

export type TrayRendererCommand = 'new_chat' | 'open_settings' | 'unload_local_models';

export interface TrayDesktopState {
  /** Hide on window close instead of quitting (from config.json desktopShell.closeToTray). */
  closeToTray: boolean;
  /** OS login item — authoritative via Electron, not config.json. */
  launchAtStartup: boolean;
  /** Tray + desktop settings are available in this shell. */
  supported: boolean;
  /** Human-readable reason when unsupported (dev browser, Linux, etc.). */
  unsupportedReason: 'browser' | 'linux' | null;
}
