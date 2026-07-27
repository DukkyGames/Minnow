/**
 * Read/write desktop shell preferences from ~/.minnow/config.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { importServerModule } from './server-import.js';

const CONFIG_FILE = 'config.json';

/** Default when config is missing or invalid. */
export const DEFAULT_CLOSE_TO_TRAY = true;

function normalizeCloseToTray(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return DEFAULT_CLOSE_TO_TRAY;
  const shell = (raw as Record<string, unknown>).desktopShell;
  if (!shell || typeof shell !== 'object') return DEFAULT_CLOSE_TO_TRAY;
  const value = (shell as Record<string, unknown>).closeToTray;
  return typeof value === 'boolean' ? value : DEFAULT_CLOSE_TO_TRAY;
}

async function resolveConfigPath(): Promise<string> {
  const { getMinnowHome } = await importServerModule<{ getMinnowHome: () => string }>(
    'config/home.js',
  );
  return path.join(getMinnowHome(), CONFIG_FILE);
}

/** Load close-to-tray from disk without starting the HTTP server. */
export async function readCloseToTrayPreference(): Promise<boolean> {
  try {
    const configPath = await resolveConfigPath();
    const raw = await fs.readFile(configPath, 'utf8');
    const meta = JSON.parse(raw) as unknown;
    return normalizeCloseToTray(meta);
  } catch {
    return DEFAULT_CLOSE_TO_TRAY;
  }
}

/** Persist close-to-tray via the config store merge helper (validates shape). */
export async function writeCloseToTrayPreference(enabled: boolean): Promise<boolean> {
  const { readConfigJson, writeConfigJson } = await importServerModule<{
    readConfigJson: (rel: string) => Promise<Record<string, unknown> | null>;
    writeConfigJson: (rel: string, data: Record<string, unknown>) => Promise<void>;
  }>('config/store.js');
  const { mergeConfigMeta } = await importServerModule<{
    mergeConfigMeta: (
      existing: Record<string, unknown> | null,
      patch: Record<string, unknown>,
    ) => Record<string, unknown>;
  }>('config/validators.js');

  const existing = (await readConfigJson(CONFIG_FILE)) ?? {};
  const merged = mergeConfigMeta(existing, {
    desktopShell: { closeToTray: enabled },
  });
  await writeConfigJson(CONFIG_FILE, merged);
  return enabled;
}
