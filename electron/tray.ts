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
import { shouldUseTemplateTrayIcon, type TrayPlatform } from './tray-icon.js';
import {
  EMPTY_TRAY_STATUS,
  formatTrayAgentLabel,
  formatTrayModelsLabel,
  type TrayRendererCommand,
  type TrayStatusSnapshot,
} from './tray-status.js';

const CLOSE_NOTIFICATION_KEY = 'minnow.tray.closeNotificationShown';

// ── Icons ────────────────────────────────────────────────────────────────────

function loadImageFromPath(iconPath: string, asTemplate: boolean): Electron.NativeImage {
  const image = nativeImage.createFromPath(iconPath);
  if (asTemplate && !image.isEmpty()) {
    image.setTemplateImage(true);
  }
  return image;
}

function loadTrayIcon(
  platform: TrayPlatform,
  primaryPath: string,
  fallbackPath: string,
): Electron.NativeImage {
  const asTemplate = shouldUseTemplateTrayIcon(platform, primaryPath);
  let image = loadImageFromPath(primaryPath, asTemplate);

  if (!image.isEmpty()) {
    return image;
  }

  console.warn(`[electron/tray] icon missing or empty: ${primaryPath}`);

  if (!fs.existsSync(fallbackPath)) {
    console.warn(`[electron/tray] fallback icon missing: ${fallbackPath}`);
    return image;
  }

  const fallbackTemplate = shouldUseTemplateTrayIcon(platform, fallbackPath);
  image = loadImageFromPath(fallbackPath, fallbackTemplate);
  if (image.isEmpty()) {
    console.warn(`[electron/tray] fallback icon empty: ${fallbackPath}`);
  }
  return image;
}

export interface TrayManagerDeps {
  trayIconPath: () => string;
  trayIconFallbackPath: () => string;
  focusMainWindow: () => void;
  requestQuit: () => void;
  sendTrayCommand: (command: TrayRendererCommand) => void;
  getCloseToTray: () => boolean;
  setCloseToTray: (enabled: boolean) => Promise<boolean>;
  getLoginItem: () => LoginItemSnapshot;
  setLoginItem: (enabled: boolean) => LoginItemSnapshot;
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

// ── Close notification ───────────────────────────────────────────────────────

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

// ── Tray manager ─────────────────────────────────────────────────────────────

/** On macOS, left-click focuses then pops the menu; setContextMenu would steal that. */
export function createTrayManager(deps: TrayManagerDeps): TrayManager {
  let tray: Tray | null = null;
  let contextMenu: Menu | null = null;
  let status: TrayStatusSnapshot = { ...EMPTY_TRAY_STATUS };
  const isDarwin = process.platform === 'darwin';

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
    contextMenu = buildMenu();
    if (!isDarwin) {
      tray.setContextMenu(contextMenu);
    }
  }

  function popUpTrayMenu(): void {
    rebuildMenu();
    tray?.popUpContextMenu(contextMenu ?? undefined);
  }

  function ensureTray(): void {
    if (tray && !tray.isDestroyed()) return;
    const image = loadTrayIcon(
      process.platform,
      deps.trayIconPath(),
      deps.trayIconFallbackPath(),
    );
    tray = new Tray(image);
    tray.setToolTip('Minnow');
    if (isDarwin) {
      tray.on('click', () => {
        deps.focusMainWindow();
        popUpTrayMenu();
      });
      tray.on('right-click', () => popUpTrayMenu());
    } else {
      tray.on('click', () => deps.focusMainWindow());
      tray.on('double-click', () => deps.focusMainWindow());
    }
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

export { readLoginItemSnapshot, writeLoginItemOpenAtLogin };
