/**
 * Electron main process: app lifecycle, BrowserWindow, dev vs prod URL loading.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
} from 'electron';
import * as channels from './ipc-channels.js';
import { importServerModule } from './server-import.js';
import { startInProcessServer, type InProcessServerHandle } from './server-host.js';
import { loadWindowState, trackWindowState } from './window-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.MINNOW_ELECTRON_DEV === '1';
const devPort = Number(process.env.PORT) || 5173;
const devUrl = `http://localhost:${devPort}/`;

let mainWindow: BrowserWindow | null = null;
let inProcessServer: InProcessServerHandle | null = null;

/** Register stub preview IPC handlers until MIN-112 wires WebContentsView. */
function registerIpcHandlers(): void {
  ipcMain.handle(channels.PREVIEW_SHOW, async () => {
    /* stub */
  });
  ipcMain.handle(channels.PREVIEW_HIDE, async () => {
    /* stub */
  });
  ipcMain.handle(channels.PREVIEW_LOAD_URL, async (_event, url: string) => {
    void url;
    /* stub */
  });
  ipcMain.handle(channels.PREVIEW_RELOAD, async () => {
    /* stub */
  });
  ipcMain.handle(channels.PREVIEW_STOP, async () => {
    /* stub */
  });
  ipcMain.handle(channels.PREVIEW_GO_BACK, async () => {
    /* stub */
  });
  ipcMain.handle(channels.PREVIEW_GO_FORWARD, async () => {
    /* stub */
  });
  ipcMain.handle(
    channels.PREVIEW_SET_BOUNDS,
    async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      void bounds;
      /* stub */
    },
  );
  ipcMain.handle(channels.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    if (typeof url === 'string' && url.trim()) {
      await shell.openExternal(url);
    }
  });
}

/** Tear down PTY sessions, generations, and in-process HTTP server. */
async function shutdownRuntime(): Promise<void> {
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
  const preloadPath = path.join(__dirname, 'preload.js');

  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    show: false,
    backgroundColor: '#0e0e10',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  if (saved.isMaximized) {
    win.maximize();
  }

  trackWindowState(win);

  win.once('ready-to-show', () => {
    win.show();
  });

  return win;
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
  // Packaged app: Vite dist and built-in assets live under the install path.
  setAppRoot(app.getAppPath());
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
