/**
 * Read/write desktop shell preferences from ~/.minnow/config.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { importServerModule } from './server-import.js';
import {
  clampShellZoomPercent,
  DEFAULT_SHELL_ZOOM_PERCENT,
} from './shell-zoom.js';

const CONFIG_FILE = 'config.json';

/** Default when config is missing or invalid. */
export const DEFAULT_CLOSE_TO_TRAY = true;

export { DEFAULT_SHELL_ZOOM_PERCENT };

function readDesktopShell(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const shell = (raw as Record<string, unknown>).desktopShell;
  return shell && typeof shell === 'object' ? (shell as Record<string, unknown>) : null;
}

function normalizeCloseToTray(raw: unknown): boolean {
  const shell = readDesktopShell(raw);
  if (!shell) return DEFAULT_CLOSE_TO_TRAY;
  const value = shell.closeToTray;
  return typeof value === 'boolean' ? value : DEFAULT_CLOSE_TO_TRAY;
}

function normalizeShellZoomPercent(raw: unknown): number {
  const shell = readDesktopShell(raw);
  if (!shell) return DEFAULT_SHELL_ZOOM_PERCENT;
  return clampShellZoomPercent(shell.zoomPercent);
}

async function resolveConfigPath(): Promise<string> {
  const { getMinnowHome } = await importServerModule<{ getMinnowHome: () => string }>(
    'config/home.js',
  );
  return path.join(getMinnowHome(), CONFIG_FILE);
}

/** Load shell zoom percent from disk without starting the HTTP server. */
export async function readShellZoomPercent(): Promise<number> {
  try {
    const configPath = await resolveConfigPath();
    const raw = await fs.readFile(configPath, 'utf8');
    const meta = JSON.parse(raw) as unknown;
    return normalizeShellZoomPercent(meta);
  } catch {
    return DEFAULT_SHELL_ZOOM_PERCENT;
  }
}

/** Persist shell zoom via the config store merge helper (validates shape). */
export async function writeShellZoomPercent(percent: number): Promise<number> {
  const next = clampShellZoomPercent(percent);
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
    desktopShell: { zoomPercent: next },
  });
  await writeConfigJson(CONFIG_FILE, merged);
  return next;
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
