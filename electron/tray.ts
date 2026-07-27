/**
 * System tray menu, close-to-hide lifecycle, and one-time close notification.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  Menu,
  nativeImage,
  Notification,
  Tray,
  type BrowserWindow,
} from 'electron';
import {
  readLoginItemSnapshot,
  writeLoginItemOpenAtLogin,
  type LoginItemSnapshot,
} from './login-item.js';
import { shouldHideWindowOnClose } from './tray-close.js';
import {
  EMPTY_TRAY_STATUS,
  formatTrayAgentLabel,
  formatTrayModelsLabel,
  type TrayRendererCommand,
  type TrayStatusSnapshot,
} from './tray-status.js';

const CLOSE_NOTIFICATION_KEY = 'minnow.tray.closeNotificationShown';

export interface TrayManagerDeps {
  iconPath: () => string;
  focusMainWindow: () => void;
  requestQuit: () => void;
  sendTrayCommand: (command: TrayRendererCommand) => void;
  getCloseToTray: () => boolean;
  setCloseToTray: (enabled: boolean) => Promise<boolean>;
  getLoginItem: () => LoginItemSnapshot;
  setLoginItem: (enabled: boolean) => LoginItemSnapshot;
  /** True when an explicit quit path is running (tray Quit, updater install). */
  isQuitInProgress: () => boolean;
}

export interface TrayManager {
  ensureTray: () => void;
  destroyTray: () => void;
  rebuildMenu: () => void;
  updateStatus: (status: TrayStatusSnapshot) => void;
  maybeNotifyHidden: () => void;
  wireWindowClose: (win: BrowserWindow) => void;
}

function loadTrayIcon(iconPath: string): Electron.NativeImage {
  const image = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin' && !image.isEmpty()) {
    image.setTemplateImage(true);
  }
  return image;
}

/** Persist one-time close notification in Electron userData (not Minnow home). */
function hasShownCloseNotification(): boolean {
  try {
    const marker = path.join(app.getPath('userData'), CLOSE_NOTIFICATION_KEY);
    return fs.existsSync(marker);
  } catch {
    return false;
  }
}

function markCloseNotificationShown(): void {
  try {
    const marker = path.join(app.getPath('userData'), CLOSE_NOTIFICATION_KEY);
    fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
  } catch {
    /* ignore */
  }
}

function showCloseNotificationOnce(): void {
  if (hasShownCloseNotification()) return;
  if (!Notification.isSupported()) {
    markCloseNotificationShown();
    return;
  }
  const notification = new Notification({
    title: 'Minnow is still running',
    body: 'Minnow was minimized to the system tray. Click the tray icon to reopen.',
    silent: true,
  });
  notification.show();
  markCloseNotificationShown();
}

export function createTrayManager(deps: TrayManagerDeps): TrayManager {
  let tray: Tray | null = null;
  let status: TrayStatusSnapshot = { ...EMPTY_TRAY_STATUS };

  function buildMenu(): Menu {
    const login = deps.getLoginItem();
    const closeToTray = deps.getCloseToTray();

    return Menu.buildFromTemplate([
      {
        label: 'Open Minnow',
        click: () => deps.focusMainWindow(),
      },
      {
        label: 'New chat',
        click: () => deps.sendTrayCommand({ type: 'new_chat' }),
      },
      { type: 'separator' },
      {
        label: formatTrayAgentLabel(status.agentCount),
        enabled: false,
      },
      {
        label: formatTrayModelsLabel(status.localModelCount, status.localModelNames),
        enabled: false,
      },
      {
        label: 'Unload local models',
        enabled: status.localModelCount > 0,
        click: () => deps.sendTrayCommand({ type: 'unload_local_models' }),
      },
      { type: 'separator' },
      {
        label: 'Open Settings',
        click: () => deps.sendTrayCommand({ type: 'open_settings' }),
      },
      {
        label: 'Launch at startup',
        type: 'checkbox',
        checked: login.openAtLogin,
        enabled: login.supported,
        click: (item) => {
          const next = deps.setLoginItem(Boolean(item.checked));
          item.checked = next.openAtLogin;
        },
      },
      {
        label: closeToTray ? 'Quit Minnow' : 'Quit',
        click: () => deps.requestQuit(),
      },
    ]);
  }

  function rebuildMenu(): void {
    if (!tray || tray.isDestroyed()) return;
    tray.setContextMenu(buildMenu());
  }

  function ensureTray(): void {
    if (tray && !tray.isDestroyed()) return;
    const image = loadTrayIcon(deps.iconPath());
    tray = new Tray(image);
    tray.setToolTip('Minnow');
    tray.on('click', () => deps.focusMainWindow());
    tray.on('double-click', () => deps.focusMainWindow());
    rebuildMenu();
  }

  function destroyTray(): void {
    if (!tray || tray.isDestroyed()) return;
    tray.destroy();
    tray = null;
  }

  function updateStatus(next: TrayStatusSnapshot): void {
    status = {
      agentCount: Math.max(0, next.agentCount),
      localModelCount: Math.max(0, next.localModelCount),
      localModelNames: [...next.localModelNames],
    };
    rebuildMenu();
  }

  function maybeNotifyHidden(): void {
    showCloseNotificationOnce();
  }

  function wireWindowClose(win: BrowserWindow): void {
    win.on('close', (event) => {
      const hide = shouldHideWindowOnClose({
        closeToTrayEnabled: deps.getCloseToTray(),
        explicitQuit: deps.isQuitInProgress(),
        quitInProgress: deps.isQuitInProgress(),
      });
      if (!hide) return;
      event.preventDefault();
      win.hide();
      maybeNotifyHidden();
    });
  }

  return {
    ensureTray,
    destroyTray,
    rebuildMenu,
    updateStatus,
    maybeNotifyHidden,
    wireWindowClose,
  };
}

/** Test helpers for login-item re-exports. */
export { readLoginItemSnapshot, writeLoginItemOpenAtLogin };
