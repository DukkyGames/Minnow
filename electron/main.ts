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
import { shouldHideMainWindowOnClose, shouldKeepAppAliveWhenAllWindowsClosed } from './close-behavior.js';
import {
  disposeTray,
  getCloseToTrayEnabled,
  initTray,
  isExplicitQuitRequested,
  markExplicitQuitRequested,
  maybeShowCloseToTrayNotification,
} from './tray.js';

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

const isDev = process.env.MINNOW_ELECTRON_DEV === '1';
const devUrl = (
  process.env.MINNOW_DEV_URL?.trim() || `http://localhost:${resolveMinnowPort()}/`
).replace(/\/?$/, '/');

let mainWindow: BrowserWindow | null = null;
let inProcessServer: InProcessServerHandle | null = null;
let quitInProgress = false;
let shellInitialized = false;

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

/** Tray Quit and other explicit shutdown paths bypass hide-to-tray. */
function requestExplicitQuit(): void {
  markExplicitQuitRequested();
  app.quit();
}

/** Intercept window close when close-to-tray is enabled — hide instead of destroy. */
function wireCloseToTrayBehavior(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (
      !shouldHideMainWindowOnClose({
        closeToTray: getCloseToTrayEnabled(),
        explicitQuit: isExplicitQuitRequested() || quitInProgress,
      })
    ) {
      return;
    }
    event.preventDefault();
    win.hide();
    maybeShowCloseToTrayNotification();
  });
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
  wireCloseToTrayBehavior(win);

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
  });

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
  // Idempotent: restore an existing hidden window instead of spawning a second shell.
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }

  if (!shellInitialized) {
    app.setName('Minnow');
    // Windows taskbar grouping / jump lists; pairs with branded electron.exe in dev (see brand-electron-win.mjs).
    if (process.platform === 'win32') {
      app.setAppUserModelId('org.grimmedia.minnow');
    }
    configurePreviewSession(session.fromPartition('persist:minnow-preview'));
    registerIpcHandlers();
    initUpdater({ prepareQuitForUpdate });
    await initTray({
      getMainWindow: () => mainWindow,
      focusMainWindow,
      requestExplicitQuit,
      iconPath: appIconPath,
    });
    shellInitialized = true;
  }

  mainWindow = await createMainWindow();
  const loadUrl = await resolveLoadUrl();
  await mainWindow.loadURL(loadUrl);
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
    if (
      shouldKeepAppAliveWhenAllWindowsClosed({
        closeToTray: getCloseToTrayEnabled(),
        platform: process.platform,
        explicitQuit: isExplicitQuitRequested() || quitInProgress,
      })
    ) {
      return;
    }
    app.quit();
  });

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      focusMainWindow();
      return;
    }
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
    disposeTray();
    shutdownRuntime()
      .catch((err) => {
        console.error('[electron] shutdown error:', err);
      })
      .finally(() => {
        app.exit(0);
      });
  });
}
