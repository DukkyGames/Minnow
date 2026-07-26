/**
 * Read/write desktopShell.closeToTray from ~/.minnow/config.json (main process).
 */

import { importServerModule } from './server-import.js';

/** Default when config is missing or invalid — close hides to tray. */
export const DEFAULT_CLOSE_TO_TRAY = true;

/** Normalize desktopShell.closeToTray; invalid values fall back to default true. */
export function normalizeCloseToTray(value: unknown): boolean {
  if (value === false) return false;
  if (value === true) return true;
  return DEFAULT_CLOSE_TO_TRAY;
}

/** Load closeToTray from persisted config.json. */
export async function readCloseToTrayFromConfig(): Promise<boolean> {
  try {
    const store = await importServerModule<{
      readConfigJson: (key: string) => Promise<Record<string, unknown> | null>;
    }>('config/store.js');
    const meta = (await store.readConfigJson('config.json')) ?? {};
    const shell = meta.desktopShell;
    if (!shell || typeof shell !== 'object') return DEFAULT_CLOSE_TO_TRAY;
    return normalizeCloseToTray((shell as Record<string, unknown>).closeToTray);
  } catch (err) {
    console.warn('[electron] could not read desktopShell.closeToTray:', err);
    return DEFAULT_CLOSE_TO_TRAY;
  }
}

/** Persist closeToTray via mergeConfigMeta (validated server-side). */
export async function writeCloseToTrayToConfig(closeToTray: boolean): Promise<boolean> {
  const normalized = normalizeCloseToTray(closeToTray);
  const store = await importServerModule<{
    updateConfigJson: (
      key: string,
      mutator: (current: Record<string, unknown> | null) => Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  }>('config/store.js');
  const validators = await importServerModule<{
    mergeConfigMeta: (
      existing: Record<string, unknown> | null,
      patch: Record<string, unknown>,
    ) => Record<string, unknown>;
  }>('config/validators.js');

  await store.updateConfigJson('config.json', (current) =>
    validators.mergeConfigMeta(current, { desktopShell: { closeToTray: normalized } }),
  );
  return normalized;
}
