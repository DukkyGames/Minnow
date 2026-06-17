/**
 * Electron main process: app lifecycle, BrowserWindow, dev vs prod URL loading.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
} from 'electron';
import { configurePreviewSession } from './preview-session.js';
import * as channels from './ipc-channels.js';
import {
  destroyAllPreviewHosts,
  registerPreviewHostIpc,
} from './preview-host.js';
import { getProjectRoot, importServerModule } from './server-import.js';
import { startInProcessServer, type InProcessServerHandle } from './server-host.js';
import { loadWindowState, trackWindowState } from './window-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.MINNOW_ELECTRON_DEV === '1';
const devPort = Number(process.env.PORT) || 5173;
const devUrl = `http://localhost:${devPort}/`;

let mainWindow: BrowserWindow | null = null;
let inProcessServer: InProcessServerHandle | null = null;

/** Register app + preview IPC handlers. */
function registerIpcHandlers(): void {
  registerPreviewHostIpc();
  ipcMain.handle(channels.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    if (typeof url === 'string' && url.trim()) {
      await shell.openExternal(url);
    }
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
