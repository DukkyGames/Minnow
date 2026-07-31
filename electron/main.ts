/**
 * Electron main process: app lifecycle, BrowserWindow, dev vs prod URL loading.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  powerMonitor,
  session,
  shell,
} from 'electron';
import { configurePreviewSession } from './preview-session.js';
import * as channels from './ipc-channels.js';
import * as crashLog from './crash-log.js';
import {
  destroyAllPreviewHosts,
  registerPreviewHostIpc,
} from './preview-host.js';
import { getProjectRoot, importServerModule } from './server-import.js';
import { startInProcessServer, type InProcessServerHandle } from './server-host.js';
import { loadWindowState, trackWindowState } from './window-state.js';
import { resolveMinnowPort } from './minnow-port.js';
import { disposeUpdater, initUpdater } from './updater.js';
import {
  readCloseToTrayPreference,
  writeCloseToTrayPreference,
} from './desktop-shell-config.js';
import { readLoginItemSnapshot, writeLoginItemOpenAtLogin } from './login-item.js';
import { createTrayManager, type TrayManager } from './tray.js';
import {
  resolveTrayIconFallbackPath,
  resolveTrayIconPath,
} from './tray-icon.js';
import { shouldQuitOnWindowAllClosed } from './tray-close.js';
import { setAfkBoardPowerGuardActive } from './afk-power-guard.js';
import {
  EMPTY_TRAY_STATUS,
  type TrayRendererCommand,
  type TrayStatusSnapshot,
} from './tray-status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Window/taskbar icon (dev and unpackaged runs; packaged builds use build/icon.ico via electron-builder). */
function appIconPath(): string {
  const root = app.isPackaged
    ? app.getAppPath()
    : getProjectRoot();
  if (process.platform === 'win32') {
    return path.join(root, 'build', 'icon.ico');
  }
  return path.join(
    root,
    'public',
    'logos',
    'minnow-logo',
    'minnow',
    'png',
    'minnow-1024.png',
  );
}

function appRoot(): string {
  return app.isPackaged ? app.getAppPath() : getProjectRoot();
}

/** System tray icon — platform-specific assets under build/tray/. */
function trayIconPath(): string {
  return resolveTrayIconPath(process.platform, appRoot());
}

function trayIconFallbackPath(): string {
  return resolveTrayIconFallbackPath(appRoot());
}

const isDev = process.env.MINNOW_ELECTRON_DEV === '1';
const devUrl = (
  process.env.MINNOW_DEV_URL?.trim() || `http://localhost:${resolveMinnowPort()}/`
).replace(/\/?$/, '/');

let mainWindow: BrowserWindow | null = null;
let inProcessServer: InProcessServerHandle | null = null;
let quitInProgress = false;
let closeToTrayEnabled = true;
let trayManager: TrayManager | null = null;
let bootstrapPromise: Promise<void> | null = null;
const queuedTrayCommands: TrayRendererCommand[] = [];
let rendererTrayReady = false;

/** Sliding window of renderer crash timestamps for anti-reload-loop. */
const rendererCrashTimestamps: number[] = [];
const RENDERER_CRASH_WINDOW_MS = 60_000;
const RENDERER_CRASH_RELOAD_CAP = 3;

/** Reload renderer after crash, or show recovery page if crashing too often. */
function recoverRenderer(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  const now = Date.now();
  rendererCrashTimestamps.push(now);
  while (
    rendererCrashTimestamps.length > 0 &&
    now - rendererCrashTimestamps[0]! > RENDERER_CRASH_WINDOW_MS
  ) {
    rendererCrashTimestamps.shift();
  }

  if (rendererCrashTimestamps.length > RENDERER_CRASH_RELOAD_CAP) {
    const recoveryHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Minnow — recovery</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0e0e10; color: #e8e8ea; margin: 0; padding: 2rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #a0a0a8; line-height: 1.5; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
    code { background: #1a1a1e; padding: 0.15rem 0.35rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Minnow keeps crashing</h1>
  <p>The renderer restarted too many times. Check <code>~/.minnow/logs/crash.jsonl</code> for details.</p>
  <button type="button" onclick="location.reload()">Reload</button>
</body>
</html>`;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(recoveryHtml)}`);
    return;
  }

  win.webContents.reload();
}

/** Notify the renderer when the display wakes so AFK boards can reconcile stalled finalizers. */
function wirePowerWakeNotifications(): void {
  const notify = (): void => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channels.POWER_SCREEN_UNLOCKED);
  };
  powerMonitor.on('resume', notify);
  powerMonitor.on('unlock-screen', notify);
}

/** Register app + preview IPC handlers. */
function registerIpcHandlers(): void {
  registerPreviewHostIpc();
  ipcMain.handle(channels.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    if (typeof url === 'string' && url.trim()) {
      await shell.openExternal(url);
    }
  });

  ipcMain.on(channels.DIAGNOSTICS_REPORT_ERROR, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Record<string, unknown>;
    const kind = typeof p.kind === 'string' ? p.kind : 'renderer-error';
    const message = typeof p.message === 'string' ? p.message : '';
    const stack = typeof p.stack === 'string' ? p.stack : undefined;
    crashLog.logCrash({ source: 'renderer', kind, message, stack });
  });

  ipcMain.handle(channels.DIAGNOSTICS_LAST_CRASH, () => {
    const marker = crashLog.readLastCrashMarker();
    crashLog.clearLastCrashMarker();
    return marker;
  });

  ipcMain.handle(channels.DIAGNOSTICS_OOM_PAUSE, () => crashLog.readOomPauseMarker());

  ipcMain.handle(channels.DIAGNOSTICS_CLEAR_OOM_PAUSE, () => {
    crashLog.clearOomPauseMarker();
  });

  ipcMain.handle(channels.POWER_SET_AFK_GUARD, (_event, active: unknown) => {
    setAfkBoardPowerGuardActive(active === true);
  });

  ipcMain.handle(channels.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle(channels.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle(channels.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(channels.WINDOW_IS_MAXIMIZED, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });

  ipcMain.handle(channels.WINDOW_RESTORE_FOCUS, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    restoreShellWindowFocus(win);
    // Chromium can restore stale dialog focus after the IPC turn on Windows.
    setTimeout(() => restoreShellWindowFocus(win), 0);
  });

  ipcMain.on(channels.TRAY_PUBLISH_STATUS, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Record<string, unknown>;
    const names = Array.isArray(p.localModelNames)
      ? p.localModelNames.filter((n): n is string => typeof n === 'string')
      : [];
    const status: TrayStatusSnapshot = {
      agentCount: typeof p.agentCount === 'number' ? p.agentCount : 0,
      localModelCount: typeof p.localModelCount === 'number' ? p.localModelCount : 0,
      localModelNames: names,
    };
    trayManager?.updateStatus(status);
  });

  ipcMain.on(channels.TRAY_NOTIFY_READY, (event) => {
    rendererTrayReady = true;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    flushQueuedTrayCommands(win);
  });

  ipcMain.handle(channels.TRAY_GET_CLOSE_TO_TRAY, () => closeToTrayEnabled);

  ipcMain.handle(channels.TRAY_SET_CLOSE_TO_TRAY, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') return closeToTrayEnabled;
    closeToTrayEnabled = await writeCloseToTrayPreference(enabled);
    trayManager?.rebuildMenu();
    mainWindow?.webContents.send(channels.TRAY_CLOSE_TO_TRAY_CHANGED, closeToTrayEnabled);
    return closeToTrayEnabled;
  });

  ipcMain.handle(channels.TRAY_GET_LOGIN_ITEM, () => readLoginItemSnapshot());

  ipcMain.handle(channels.TRAY_SET_LOGIN_ITEM, (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') return readLoginItemSnapshot();
    const next = writeLoginItemOpenAtLogin(enabled);
    trayManager?.rebuildMenu();
    return next;
  });
}

/** Push shell maximize state to the renderer for menubar control icons. */
function wireShellWindowState(win: BrowserWindow): void {
  const emit = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.send(channels.WINDOW_MAXIMIZED_CHANGED, win.isMaximized());
  };

  win.on('maximize', emit);
  win.on('unmaximize', emit);
  win.on('enter-full-screen', emit);
  win.on('leave-full-screen', emit);
  win.webContents.on('did-finish-load', emit);
}

/** Tear down PTY sessions, generations, and in-process HTTP server. */
async function shutdownRuntime(): Promise<void> {
  destroyAllPreviewHosts();
  const [ptyHost, generationsStore] = await Promise.all([
    importServerModule<{ destroyAllPtySessions: () => void }>('terminal/pty-host.js'),
    importServerModule<{ deleteGenerationsForProviderShutdown: () => void }>(
      'generations/store.js',
    ),
  ]);
  const { destroyAllPtySessions } = ptyHost;
  const { deleteGenerationsForProviderShutdown } = generationsStore;
  destroyAllPtySessions();
  deleteGenerationsForProviderShutdown();
  if (inProcessServer) {
    const close = inProcessServer.close;
    inProcessServer = null;
    await close();
  }
}

/**
 * Tear down the runtime ahead of autoUpdater.quitAndInstall() and mark quit as in
 * progress so the before-quit handler lets the install-triggered quit proceed.
 */
async function prepareQuitForUpdate(): Promise<void> {
  if (quitInProgress) return;
  quitInProgress = true;
  disposeUpdater();
  await shutdownRuntime();
}

function restoreShellWindowFocus(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.focus();
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  restoreShellWindowFocus(mainWindow);
}

function sendTrayCommand(command: TrayRendererCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!rendererTrayReady) {
    queuedTrayCommands.push(command);
    return;
  }
  mainWindow.webContents.send(channels.TRAY_COMMAND, command);
}

function flushQueuedTrayCommands(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  while (queuedTrayCommands.length > 0) {
    const command = queuedTrayCommands.shift();
    if (command) win.webContents.send(channels.TRAY_COMMAND, command);
  }
}

function requestExplicitQuit(): void {
  if (quitInProgress) return;
  quitInProgress = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
  app.quit();
}

function ensureTrayManager(): TrayManager {
  if (!trayManager) {
    trayManager = createTrayManager({
      trayIconPath,
      trayIconFallbackPath,
      focusMainWindow,
      requestQuit: requestExplicitQuit,
      sendTrayCommand: (command) => {
        focusMainWindow();
        sendTrayCommand(command);
      },
      getCloseToTray: () => closeToTrayEnabled,
      setCloseToTray: async (enabled) => {
        closeToTrayEnabled = await writeCloseToTrayPreference(enabled);
        mainWindow?.webContents.send(channels.TRAY_CLOSE_TO_TRAY_CHANGED, closeToTrayEnabled);
        return closeToTrayEnabled;
      },
      getLoginItem: readLoginItemSnapshot,
      setLoginItem: writeLoginItemOpenAtLogin,
      isQuitInProgress: () => quitInProgress,
    });
  }
  return trayManager;
}

async function createMainWindow(): Promise<BrowserWindow> {
  const saved = await loadWindowState();
  // Preload is renamed to .mjs by scripts/rename-preload-mjs.mjs because Electron
  // loads .js preloads as CommonJS regardless of package.json "type": "module".
  const preloadPath = path.join(__dirname, 'preload.mjs');

  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    show: false,
    icon: appIconPath(),
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 14, y: 14 },
        }
      : { frame: false, thickFrame: true }),
    backgroundColor: '#0e0e10',
    webPreferences: {
      preload: preloadPath,
      // ESM preload (.mjs) requires sandbox: false; contextIsolation + no node integration
      // still prevent the renderer from escalating.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      // Keep AFK board/chat timers + SSE delivery alive when the display sleeps.
      backgroundThrottling: false,
    },
  });

  if (saved.isMaximized) {
    win.maximize();
  }

  trackWindowState(win);
  wireShellWindowState(win);

  const showFallbackTimer = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      console.warn('[electron] Showing window after load timeout');
      win.show();
    }
  }, 15_000);

  win.once('ready-to-show', () => {
    clearTimeout(showFallbackTimer);
    win.show();
  });

  win.on('closed', () => {
    clearTimeout(showFallbackTimer);
    if (mainWindow === win) {
      mainWindow = null;
      rendererTrayReady = false;
    }
  });

  ensureTrayManager().wireWindowClose(win);

  // If Vite is still warming up or load fails, avoid an invisible window on first launch.
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(
      `[electron] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`,
    );
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    crashLog.logCrash({
      source: 'renderer',
      kind: 'render-process-gone',
      reason: details.reason,
      exitCode: details.exitCode,
      message: `Renderer process gone: ${details.reason}`,
    });
    crashLog.writeLastCrashMarker({
      kind: 'render-process-gone',
      reason: details.reason,
      exitCode: details.exitCode,
      message: `Renderer process gone: ${details.reason}`,
    });
    if (details.reason === 'oom') {
      crashLog.writeOomPauseMarker();
    }
    crashLog.flushCrashLogSync();
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    recoverRenderer(win);
  });

  win.webContents.on('unresponsive', () => {
    crashLog.logCrash({
      source: 'renderer',
      kind: 'unresponsive',
      message: 'Renderer became unresponsive',
    });
    crashLog.flushCrashLogSync();
  });

  win.webContents.on('responsive', () => {
    crashLog.logCrash({
      source: 'renderer',
      kind: 'responsive',
      message: 'Renderer became responsive again',
    });
  });

  return win;
}

/** Packaged app: resources dir with bundled dist/. Unpackaged electron:prod: repo root. */
function resolveElectronAppRoot(): string {
  if (app.isPackaged) {
    return app.getAppPath();
  }
  return getProjectRoot();
}

async function resolveLoadUrl(): Promise<string> {
  if (isDev) {
    return devUrl;
  }

  const { setAppRoot } = await importServerModule<{ setAppRoot: (dir: string) => void }>(
    'workspace/root.js',
  );
  const { bootstrapMinnowRuntime } = await importServerModule<{
    bootstrapMinnowRuntime: () => Promise<{
      workspacePath: string;
      homePath: string;
    }>;
  }>('runtime/bootstrap.js');
  setAppRoot(resolveElectronAppRoot());
  const { workspacePath, homePath } = await bootstrapMinnowRuntime();
  console.log(`Workspace: ${workspacePath}`);
  console.log(`Minnow data: ${homePath}`);

  inProcessServer = await startInProcessServer();
  return inProcessServer.url;
}

async function bootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = bootstrapInner();
  try {
    await bootstrapPromise;
  } catch (err) {
    bootstrapPromise = null;
    throw err;
  }
}

async function bootstrapInner(): Promise<void> {
  app.setName('Minnow');
  // Windows taskbar grouping / jump lists; pairs with branded electron.exe in dev (see brand-electron-win.mjs).
  if (process.platform === 'win32') {
    app.setAppUserModelId('org.grimmedia.minnow');
  }
  configurePreviewSession(session.fromPartition('persist:minnow-preview'));
  registerIpcHandlers();
  wirePowerWakeNotifications();
  initUpdater({ prepareQuitForUpdate });

  closeToTrayEnabled = await readCloseToTrayPreference();
  const tray = ensureTrayManager();
  tray.ensureTray();
  tray.updateStatus({ ...EMPTY_TRAY_STATUS });

  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }

  // Window creation and runtime/server bootstrap are independent (window state reads
  // Electron userData, not the Minnow home dir), so overlap them — the shell is then
  // ready to load the moment the server URL resolves.
  const loadUrlPromise = resolveLoadUrl();
  // Keep the rejection handled even if createMainWindow() rejects first.
  loadUrlPromise.catch(() => {});

  mainWindow = await createMainWindow();
  rendererTrayReady = false;
  await mainWindow.loadURL(await loadUrlPromise);
}

/** Surface fatal startup errors — packaged runs have no terminal for console.error. */
function failBootstrap(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  crashLog.logCrash({
    source: 'main',
    kind: 'bootstrap-failed',
    message,
    stack,
  });
  crashLog.flushCrashLogSync();
  console.error('[electron] bootstrap failed:', err);
  dialog.showErrorBox(
    'Minnow failed to start',
    `${message}\n\nDetails may be in ~/.minnow/logs/crash.jsonl`,
  );
  app.exit(1);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  crashReporter.start({ uploadToServer: false, compress: true });

  process.on('uncaughtException', (err) => {
    crashLog.logCrash({
      source: 'main',
      kind: 'uncaughtException',
      message: err?.message ?? String(err),
      stack: err?.stack,
    });
    crashLog.flushCrashLogSync();
    console.error('[electron] uncaughtException:', err);
  });

  process.on('unhandledRejection', (reason) => {
    const message =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    crashLog.logCrash({
      source: 'main',
      kind: 'unhandledRejection',
      message,
      stack,
    });
    console.error('[electron] unhandledRejection:', reason);
  });

  app.on('child-process-gone', (_event, details) => {
    crashLog.logCrash({
      source: 'child',
      kind: 'child-process-gone',
      reason: details.reason,
      exitCode: details.exitCode,
      message: `Child process gone: ${details.type}`,
      extra: {
        type: details.type,
        name: details.name,
        serviceName: details.serviceName,
      },
    });
    console.error('[electron] child-process-gone:', details);
  });

  app.on('second-instance', () => {
    focusMainWindow();
  });

  app.whenReady().then(() => {
    bootstrap().catch(failBootstrap);
  });

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return;
    if (quitInProgress) {
      app.quit();
      return;
    }
    if (!shouldQuitOnWindowAllClosed(closeToTrayEnabled)) return;
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootstrap().catch(failBootstrap);
    } else {
      focusMainWindow();
    }
  });

  app.on('before-quit', (event) => {
    if (quitInProgress) return;
    event.preventDefault();
    quitInProgress = true;
    disposeUpdater();
    trayManager?.destroyTray();
    shutdownRuntime()
      .catch((err) => {
        console.error('[electron] shutdown error:', err);
      })
      .finally(() => {
        app.exit(0);
      });
  });
}
