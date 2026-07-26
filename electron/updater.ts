/**
 * Auto-update controller (MIN-384): electron-updater against GitHub Releases.
 * Checks on launch + every 4h, downloads in the background, installs on restart.
 * Never blocks app launch; background failures are silent-with-log.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  AppImageUpdater,
  MacUpdater,
  NsisUpdater,
  type AppUpdater,
} from 'electron-updater';
import { ElectronAppAdapter } from 'electron-updater/out/ElectronAppAdapter.js';
import * as channels from './ipc-channels.js';
import {
  createInitialUpdaterStatus,
  normalizeUpdaterChannel,
  reduceUpdaterStatus,
  releaseNotesToText,
  UPDATER_CHECK_INTERVAL_MS,
  type UpdaterChannel,
  type UpdaterEvent,
  type UpdaterStatus,
  type UpdaterUnsupportedReason,
} from './updater-core.js';

/**
 * Windows dev branding may stamp electron.exe with a 4-part product version (e.g. 1.0.2.0).
 * electron-updater requires semver, so coerce before AppUpdater validates app.version.
 */
function normalizeExeProductVersion(raw: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)\.0$/.exec(raw);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : raw;
}

class SemverCoercedAppAdapter extends ElectronAppAdapter {
  override get version(): string {
    return normalizeExeProductVersion(super.version);
  }
}

function createAutoUpdater(): AppUpdater {
  const appAdapter = new SemverCoercedAppAdapter();
  if (process.platform === 'win32') return new NsisUpdater(undefined, appAdapter);
  if (process.platform === 'darwin') return new MacUpdater(undefined, appAdapter);
  return new AppImageUpdater(undefined, appAdapter);
}

const autoUpdater = createAutoUpdater();

const CHANNEL_FILE = 'updater.json';
const FIRST_CHECK_DELAY_MS = 15_000;

let status: UpdaterStatus | null = null;
let prepareQuit: (() => Promise<void>) | null = null;
let manualCheckInFlight = false;
let checkInFlight = false;
let firstCheckTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

/** ~/.minnow (or MINNOW_HOME) — same resolution order as crash-log.ts. */
function minnowHomeDir(): string {
  const override = process.env.MINNOW_HOME;
  if (typeof override === 'string' && override.trim()) return override.trim();
  const homedir = os.homedir();
  if (homedir) return path.join(homedir, '.minnow');
  return path.join(os.tmpdir(), '.minnow');
}

function channelFilePath(): string {
  return path.join(minnowHomeDir(), CHANNEL_FILE);
}

function loadPersistedChannel(): UpdaterChannel {
  try {
    const raw = fs.readFileSync(channelFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as { channel?: unknown };
    return normalizeUpdaterChannel(parsed?.channel);
  } catch {
    return 'stable';
  }
}

function persistChannel(channel: UpdaterChannel): void {
  try {
    fs.mkdirSync(minnowHomeDir(), { recursive: true });
    fs.writeFileSync(channelFilePath(), `${JSON.stringify({ channel }, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[updater] could not persist channel:', err);
  }
}

/**
 * Packaged macOS builds must be signed with a Developer ID cert for auto-update.
 * Unsigned/ad-hoc installs keep the legacy unsupported state in Settings.
 */
function isMacAppSignedForUpdate(): boolean {
  if (process.platform !== 'darwin' || !app.isPackaged) return false;
  try {
    const result = spawnSync('codesign', ['-dv', process.execPath], { encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (/Signature=adhoc/i.test(output)) return false;
    return /Authority=Developer ID Application/i.test(output);
  } catch {
    return false;
  }
}

/**
 * Windows NSIS works unsigned; macOS auto-update requires a signed Developer ID build.
 * Dev/unpackaged runs have no install to update.
 */
function detectSupport(): { supported: boolean; reason: UpdaterUnsupportedReason | null } {
  if (!app.isPackaged) return { supported: false, reason: 'dev' };
  if (process.platform === 'darwin' && !isMacAppSignedForUpdate()) {
    return { supported: false, reason: 'macos-signing' };
  }
  return { supported: true, reason: null };
}

function dispatch(event: UpdaterEvent): void {
  if (!status) return;
  const next = reduceUpdaterStatus(status, event);
  if (next === status) return;
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channels.UPDATER_STATUS_CHANGED, status);
    }
  }
}

function wireAutoUpdaterEvents(): void {
  autoUpdater.on('checking-for-update', () => {
    dispatch({ kind: 'check-started', manual: manualCheckInFlight, at: Date.now() });
  });

  autoUpdater.on('update-available', (info) => {
    dispatch({
      kind: 'update-available',
      version: info.version,
      notes: releaseNotesToText(info.releaseNotes),
      at: Date.now(),
    });
  });

  autoUpdater.on('update-not-available', () => {
    checkInFlight = false;
    manualCheckInFlight = false;
    dispatch({ kind: 'update-not-available', at: Date.now() });
  });

  autoUpdater.on('download-progress', (progress) => {
    dispatch({ kind: 'download-progress', percent: progress.percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    checkInFlight = false;
    manualCheckInFlight = false;
    dispatch({
      kind: 'update-downloaded',
      version: info.version,
      notes: releaseNotesToText(info.releaseNotes),
      at: Date.now(),
    });
  });

  autoUpdater.on('error', (err) => {
    const manual = manualCheckInFlight;
    checkInFlight = false;
    manualCheckInFlight = false;
    console.error('[updater] update check failed:', err?.message ?? err);
    dispatch({
      kind: 'check-error',
      message: err?.message ?? 'Update check failed',
      manual,
      at: Date.now(),
    });
  });
}

function startCheck(manual: boolean): void {
  if (!status?.supported || checkInFlight) return;
  if (status.state === 'downloading' || status.state === 'ready') return;
  checkInFlight = true;
  manualCheckInFlight = manual;
  // Errors surface through the 'error' event above; swallow the rejection so a
  // failed background check never becomes an unhandledRejection.
  autoUpdater.checkForUpdates().catch(() => {});
}

function scheduleBackgroundChecks(): void {
  firstCheckTimer = setTimeout(() => {
    startCheck(false);
  }, FIRST_CHECK_DELAY_MS);
  intervalTimer = setInterval(() => {
    startCheck(false);
    dispatch({ kind: 'next-check-scheduled', at: Date.now() + UPDATER_CHECK_INTERVAL_MS });
  }, UPDATER_CHECK_INTERVAL_MS);
  dispatch({ kind: 'next-check-scheduled', at: Date.now() + UPDATER_CHECK_INTERVAL_MS });
}

function registerUpdaterIpc(): void {
  ipcMain.handle(channels.UPDATER_GET_STATUS, () => status);

  ipcMain.handle(channels.UPDATER_CHECK_NOW, () => {
    startCheck(true);
    return status;
  });

  ipcMain.handle(channels.UPDATER_SET_CHANNEL, (_event, rawChannel: unknown) => {
    const channel = normalizeUpdaterChannel(rawChannel);
    if (status && channel !== status.channel) {
      persistChannel(channel);
      dispatch({ kind: 'channel-changed', channel });
      if (status.supported) {
        // Beta rides GitHub pre-releases; switching takes effect on the next check,
        // which we trigger immediately so the change is visible (spec: no reinstall).
        autoUpdater.allowPrerelease = channel === 'beta';
        startCheck(true);
      }
    }
    return status;
  });

  ipcMain.handle(channels.UPDATER_RESTART, async () => {
    if (!status?.supported || status.state !== 'ready') return false;
    try {
      await prepareQuit?.();
    } catch (err) {
      console.error('[updater] shutdown before install failed:', err);
    }
    autoUpdater.quitAndInstall(false, true);
    return true;
  });
}

/**
 * Initialize the updater. Registers IPC in every environment (so the renderer can
 * always read status) but only schedules checks on supported packaged installs.
 * `prepareQuitForUpdate` must tear down the runtime and mark quit-in-progress so
 * main.ts's before-quit handler lets quitAndInstall proceed.
 */
export function initUpdater(options: { prepareQuitForUpdate: () => Promise<void> }): void {
  if (status) return; // bootstrap() can re-run on macOS activate; IPC must register once
  prepareQuit = options.prepareQuitForUpdate;
  const { supported, reason } = detectSupport();
  const channel = loadPersistedChannel();

  status = createInitialUpdaterStatus({
    supported,
    unsupportedReason: reason,
    installedVersion: app.getVersion(),
    channel,
  });

  registerUpdaterIpc();
  if (!supported) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = channel === 'beta';
  autoUpdater.logger = null;

  wireAutoUpdaterEvents();
  scheduleBackgroundChecks();
}

/** Stop scheduled checks (app shutdown). */
export function disposeUpdater(): void {
  if (firstCheckTimer) clearTimeout(firstCheckTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  firstCheckTimer = null;
  intervalTimer = null;
}
