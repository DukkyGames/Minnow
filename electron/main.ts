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
  readHardwareAccelerationPreference,
  readHardwareAccelerationSync,
  readShellZoomPercent,
  writeCloseToTrayPreference,
  writeHardwareAccelerationPreference,
  writeShellZoomPercent,
} from './desktop-shell-config.js';
import { applyShellZoom, DEFAULT_SHELL_ZOOM_PERCENT, shellZoomFactorFromPercent, wireShellZoom } from './shell-zoom.js';
import { readLoginItemSnapshot, writeLoginItemOpenAtLogin } from './login-item.js';
import { createTrayManager, type TrayManager } from './tray.js';
import {
  resolveTrayIconFallbackPath,
  resolveTrayIconPath,
} from './tray-icon.js';
import { shouldQuitOnWindowAllClosed } from './tray-close.js';
import { revealAbsolutePathInExplorer } from './shell-reveal.js';
import { setAfkBoardPowerGuardActive } from './afk-power-guard.js';
import {
  EMPTY_TRAY_STATUS,
  type TrayRendererCommand,
  type TrayStatusSnapshot,
} from './tray-status.js';

// ── App paths ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function trayIconPath(): string {
  return resolveTrayIconPath(process.platform, appRoot());
}

function trayIconFallbackPath(): string {
  return resolveTrayIconFallbackPath(appRoot());
}

// ── Shell state ──────────────────────────────────────────────────────────────

const isDev = process.env.MINNOW_ELECTRON_DEV === '1';
// Vite HMR needs eval in dev; suppress Electron's expected CSP warning.
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}
const devUrl = (
  process.env.MINNOW_DEV_URL?.trim() || `http://localhost:${resolveMinnowPort()}/`
).replace(/\/?$/, '/');

let mainWindow: BrowserWindow | null = null;
let inProcessServer: InProcessServerHandle | null = null;
let quitInProgress = false;
let closeToTrayEnabled = true;
let shellZoomPercent = DEFAULT_SHELL_ZOOM_PERCENT;
let trayManager: TrayManager | null = null;
let bootstrapPromise: Promise<void> | null = null;
const queuedTrayCommands: TrayRendererCommand[] = [];
let rendererTrayReady = false;

// ── Renderer recovery ────────────────────────────────────────────────────────

const rendererCrashTimestamps: number[] = [];
const RENDERER_CRASH_WINDOW_MS = 60_000;
const RENDERER_CRASH_RELOAD_CAP = 3;

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

function wirePowerWakeNotifications(): void {
  const notify = (): void => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channels.POWER_SCREEN_UNLOCKED);
  };
  powerMonitor.on('resume', notify);
  powerMonitor.on('unlock-screen', notify);
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  registerPreviewHostIpc();
  ipcMain.handle(channels.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    if (typeof url === 'string' && url.trim()) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle(
    channels.SHELL_REVEAL_IN_EXPLORER,
    async (_event, absolutePath: unknown, kind: unknown) => {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        return { ok: false, error: 'path is required' };
      }
      if (kind !== 'file' && kind !== 'dir') {
        return { ok: false, error: 'kind must be file or dir' };
      }
      return revealAbsolutePathInExplorer(absolutePath.trim(), kind);
    },
  );

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

  ipcMain.handle(channels.APP_GET_HARDWARE_ACCELERATION, () =>
    readHardwareAccelerationPreference(),
  );

  ipcMain.handle(channels.APP_SET_HARDWARE_ACCELERATION, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') return readHardwareAccelerationPreference();
    return writeHardwareAccelerationPreference(enabled);
  });

  ipcMain.handle(channels.APP_RESTART, async () => {
    await prepareQuitForUpdate();
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle(channels.SHELL_GET_ZOOM_PERCENT, () => shellZoomPercent);

  ipcMain.handle(channels.SHELL_SET_ZOOM_PERCENT, async (_event, percent: unknown) => {
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return shellZoomPercent;
    shellZoomPercent = await writeShellZoomPercent(percent);
    const win = mainWindow;
    if (win && !win.isDestroyed()) {
      applyShellZoom(win.webContents, shellZoomPercent);
      win.webContents.send(channels.SHELL_ZOOM_PERCENT_CHANGED, shellZoomPercent);
    }
    return shellZoomPercent;
  });
}

// ── Window chrome ────────────────────────────────────────────────────────────

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

function wireShellWindowVisibility(win: BrowserWindow): void {
  const emit = (): void => {
    if (win.isDestroyed()) return;
    const visible = win.isVisible() && !win.isMinimized();
    win.webContents.send(channels.WINDOW_VISIBILITY_CHANGED, visible);
  };

  win.on('show', emit);
  win.on('hide', emit);
  win.on('minimize', emit);
  win.on('restore', emit);
  win.webContents.on('did-finish-load', emit);
}

async function pauseOrchestrateBoardsInRenderer(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  try {
    win.webContents.send(channels.BOARD_PAUSE_FOR_SHUTDOWN);
    await win.webContents.executeJavaScript(
      '(typeof globalThis.__minnowPrepareForShutdown==="function"&&globalThis.__minnowPrepareForShutdown())||(typeof globalThis.__minnowPauseBoardsForShutdown==="function"&&globalThis.__minnowPauseBoardsForShutdown())',
      true,
    );
  } catch {
  }
}

// ── Shutdown ─────────────────────────────────────────────────────────────────

async function shutdownRuntime(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await pauseOrchestrateBoardsInRenderer(mainWindow);
  }
  destroyAllPreviewHosts();
  const [ptyHost, generationsStore, modelsIndex, serversIndex] = await Promise.all([
    importServerModule<{ destroyAllPtySessions: () => void }>('terminal/pty-host.js'),
    importServerModule<{ deleteGenerationsForProviderShutdown: () => void }>(
      'generations/store.js',
    ),
    importServerModule<{ shutdownAllModelServes: () => Promise<void> }>('models/index.js'),
    importServerModule<{ shutdownAllServers: () => Promise<void> }>('servers/index.js'),
  ]);
  const { destroyAllPtySessions } = ptyHost;
  const { deleteGenerationsForProviderShutdown } = generationsStore;
  const { shutdownAllModelServes } = modelsIndex;
  const { shutdownAllServers } = serversIndex;
  destroyAllPtySessions();
  deleteGenerationsForProviderShutdown();
  await shutdownAllModelServes().catch((err) => {
    console.error('[electron] shutdown model serves failed:', err);
  });
  await shutdownAllServers().catch((err) => {
    console.error('[electron] shutdown managed servers failed:', err);
  });
  if (inProcessServer) {
    const close = inProcessServer.close;
    inProcessServer = null;
    await close();
  }
}

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

// ── Tray ─────────────────────────────────────────────────────────────────────

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

// ── Main window ──────────────────────────────────────────────────────────────

// Preload is electron/preload.mjs; Electron treats .js preloads as CommonJS.
async function createMainWindow(): Promise<BrowserWindow> {
  const saved = await loadWindowState();
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
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      zoomFactor: shellZoomFactorFromPercent(shellZoomPercent),
      backgroundThrottling: false,
    },
  });

  wireShellWindowVisibility(win);

  wireShellZoom(win, {
    readPercent: async () => shellZoomPercent,
    writePercent: async (percent) => {
      shellZoomPercent = await writeShellZoomPercent(percent);
      return shellZoomPercent;
    },
    notifyPercentChanged: (percent) => {
      if (win.isDestroyed()) return;
      win.webContents.send(channels.SHELL_ZOOM_PERCENT_CHANGED, percent);
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

// ── Bootstrap ────────────────────────────────────────────────────────────────

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
  if (process.platform === 'win32') {
    app.setAppUserModelId('org.grimmedia.minnow');
  }
  configurePreviewSession(session.fromPartition('persist:minnow-preview'));
  registerIpcHandlers();
  wirePowerWakeNotifications();
  initUpdater({ prepareQuitForUpdate });

  closeToTrayEnabled = await readCloseToTrayPreference();
  shellZoomPercent = await readShellZoomPercent();
  const tray = ensureTrayManager();
  tray.ensureTray();
  tray.updateStatus({ ...EMPTY_TRAY_STATUS });

  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }

  const loadUrlPromise = resolveLoadUrl();
  loadUrlPromise.catch(() => {});

  mainWindow = await createMainWindow();
  rendererTrayReady = false;
  await mainWindow.loadURL(await loadUrlPromise);
}

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

// ── App lifecycle ────────────────────────────────────────────────────────────

// Must run before Electron ready; disableHardwareAcceleration is a no-op after that.
if (!readHardwareAccelerationSync()) app.disableHardwareAcceleration();

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
