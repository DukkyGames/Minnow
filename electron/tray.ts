/**
 * System tray menu, close-to-hide lifecycle, and tray IPC (main process).
 */

import {
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  Notification,
} from 'electron';
import * as channels from './ipc-channels.js';
import {
  readCloseToTrayFromConfig,
  writeCloseToTrayToConfig,
} from './desktop-shell-config.js';
import { readLaunchAtStartup, writeLaunchAtStartup } from './login-item.js';
import type { TrayDesktopState, TrayRendererCommand, TrayStatusSnapshot } from './tray-types.js';
import { buildTrayMenuTemplate } from './tray-menu-template.js';
import {
  markCloseNotificationShown,
  readCloseNotificationShown,
} from './tray-hints.js';

let tray: Tray | null = null;
let trayInitialized = false;
let closeToTrayEnabled = true;
let explicitQuitRequested = false;
let closeNotificationShown = false;
let trayStatus: TrayStatusSnapshot = { runningAgentCount: 0, loadedLocalModels: [] };

type TrayDeps = {
  getMainWindow: () => BrowserWindow | null;
  focusMainWindow: () => void;
  requestExplicitQuit: () => void;
  iconPath: () => string;
};

let deps: TrayDeps | null = null;

/** Whether tray + desktop shell settings are supported on this platform. */
export function isTrayPlatformSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

function buildDesktopState(): TrayDesktopState {
  const supported = isTrayPlatformSupported();
  return {
    closeToTray: closeToTrayEnabled,
    launchAtStartup: readLaunchAtStartup(),
    supported,
    unsupportedReason: !supported ? 'linux' : null,
  };
}

function trayIconImage(iconPath: string): Electron.NativeImage {
  const image = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }
  return image;
}

function rebuildTrayMenu(): void {
  if (!tray || !deps) return;
  const template = buildTrayMenuTemplate({
    status: trayStatus,
    launchAtStartup: readLaunchAtStartup(),
    onOpen: () => deps!.focusMainWindow(),
    onNewChat: () => sendTrayCommand('new_chat'),
    onUnloadModels: () => sendTrayCommand('unload_local_models'),
    onOpenSettings: () => sendTrayCommand('open_settings'),
    onToggleStartup: (enabled) => {
      writeLaunchAtStartup(enabled);
      rebuildTrayMenu();
    },
    onQuit: () => deps!.requestExplicitQuit(),
  });
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip('Minnow');
}

function sendTrayCommand(command: TrayRendererCommand): void {
  deps?.focusMainWindow();
  const win = deps?.getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channels.TRAY_COMMAND, command);
}

/** Show the one-time native notification after the first hide-to-tray close. */
export function maybeShowCloseToTrayNotification(): void {
  if (closeNotificationShown || readCloseNotificationShown()) {
    closeNotificationShown = true;
    return;
  }
  if (!Notification.isSupported()) {
    markCloseNotificationShown();
    closeNotificationShown = true;
    return;
  }
  const notification = new Notification({
    title: 'Minnow is still running',
    body: 'Minnow was minimized to the system tray. Click the tray icon to reopen.',
  });
  notification.show();
  markCloseNotificationShown();
  closeNotificationShown = true;
}

function registerTrayIpc(): void {
  ipcMain.handle(channels.TRAY_GET_DESKTOP_STATE, () => buildDesktopState());

  ipcMain.handle(channels.TRAY_SET_CLOSE_TO_TRAY, async (_event, value: unknown) => {
    const next = await writeCloseToTrayToConfig(value === true);
    closeToTrayEnabled = next;
    rebuildTrayMenu();
    return buildDesktopState();
  });

  ipcMain.handle(channels.TRAY_SET_LAUNCH_AT_STARTUP, (_event, value: unknown) => {
    writeLaunchAtStartup(value === true);
    rebuildTrayMenu();
    return buildDesktopState();
  });

  ipcMain.handle(channels.TRAY_PUBLISH_STATUS, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return trayStatus;
    const p = payload as Partial<TrayStatusSnapshot>;
    trayStatus = {
      runningAgentCount:
        typeof p.runningAgentCount === 'number' && Number.isFinite(p.runningAgentCount)
          ? Math.max(0, Math.floor(p.runningAgentCount))
          : 0,
      loadedLocalModels: Array.isArray(p.loadedLocalModels)
        ? p.loadedLocalModels
            .filter(
              (row): row is TrayStatusSnapshot['loadedLocalModels'][number] =>
                !!row &&
                typeof row === 'object' &&
                typeof (row as { id?: unknown }).id === 'string' &&
                typeof (row as { label?: unknown }).label === 'string' &&
                ((row as { source?: unknown }).source === 'lm-studio' ||
                  (row as { source?: unknown }).source === 'minnow-serve'),
            )
            .map((row) => ({
              id: row.id,
              label: row.label,
              source: row.source,
            }))
        : [],
    };
    rebuildTrayMenu();
    return trayStatus;
  });

  ipcMain.handle(channels.TRAY_REFRESH_CLOSE_TO_TRAY, async () => {
    closeToTrayEnabled = await readCloseToTrayFromConfig();
    rebuildTrayMenu();
    return buildDesktopState();
  });
}

/**
 * Create the tray icon and wire IPC. Idempotent — safe to call once at bootstrap.
 * Startup registration launches normally (not hidden).
 */
export async function initTray(options: TrayDeps): Promise<void> {
  if (trayInitialized) return;
  trayInitialized = true;
  deps = options;
  closeToTrayEnabled = await readCloseToTrayFromConfig();
  closeNotificationShown = readCloseNotificationShown();
  registerTrayIpc();

  if (!isTrayPlatformSupported()) {
    return;
  }

  const icon = trayIconImage(options.iconPath());
  tray = new Tray(icon);
  tray.setToolTip('Minnow');
  tray.on('click', () => {
    options.focusMainWindow();
  });
  rebuildTrayMenu();
}

/** Update tray menu after external config changes. */
export function refreshTrayDesktopState(closeToTray: boolean): void {
  closeToTrayEnabled = closeToTray;
  rebuildTrayMenu();
}

export function isExplicitQuitRequested(): boolean {
  return explicitQuitRequested;
}

export function markExplicitQuitRequested(): void {
  explicitQuitRequested = true;
}

export function getCloseToTrayEnabled(): boolean {
  return closeToTrayEnabled;
}

export function disposeTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

export { readCloseNotificationShown, markCloseNotificationShown } from './tray-hints.js';
