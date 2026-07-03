/**
 * Electron main process: app lifecycle, BrowserWindow, dev vs prod URL loading.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  crashReporter,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Window/taskbar icon (dev and unpackaged runs; packaged builds use build/icon.ico via electron-builder). */
function appIconPath(): string {
  const root = getProjectRoot();
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

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
    backgroundColor: '#0e0e10',
    webPreferences: {
      preload: preloadPath,
      // ESM preload (.mjs) requires sandbox: false; contextIsolation + no node integration
      // still prevent the renderer from escalating.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  if (saved.isMaximized) {
    win.maximize();
  }

  trackWindowState(win);

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
      reefSyncCount: number;
    }>;
  }>('runtime/bootstrap.js');
  setAppRoot(resolveElectronAppRoot());
  const { workspacePath, homePath, reefSyncCount } = await bootstrapMinnowRuntime();
  if (reefSyncCount > 0) {
    console.log(`Reef widgets: synced ${reefSyncCount} template(s)`);
  }
  console.log(`Workspace: ${workspacePath}`);
  console.log(`Minnow data: ${homePath}`);

  inProcessServer = await startInProcessServer();
  return inProcessServer.url;
}

async function bootstrap(): Promise<void> {
  app.setName('Minnow');
  // Windows taskbar grouping / jump lists; pairs with branded electron.exe in dev (see brand-electron-win.mjs).
  if (process.platform === 'win32') {
    app.setAppUserModelId('org.grimmedia.minnow');
  }
  configurePreviewSession(session.fromPartition('persist:minnow-preview'));
  registerIpcHandlers();

  mainWindow = await createMainWindow();
  const loadUrl = await resolveLoadUrl();
  await mainWindow.loadURL(loadUrl);
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
    bootstrap().catch((err) => {
      console.error('[electron] bootstrap failed:', err);
      app.exit(1);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootstrap().catch((err) => {
        console.error('[electron] bootstrap failed:', err);
        app.exit(1);
      });
    } else {
      focusMainWindow();
    }
  });

  let quitInProgress = false;
  app.on('before-quit', (event) => {
    if (quitInProgress) return;
    event.preventDefault();
    quitInProgress = true;
    shutdownRuntime()
      .catch((err) => {
        console.error('[electron] shutdown error:', err);
      })
      .finally(() => {
        app.exit(0);
      });
  });
}
