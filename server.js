/**
 * Minnow dev server: Vite + /api/* middleware for LM Studio tool execution.
 * Runtime wiring lives in server/runtime/* for reuse by a future Electron HTTP host.
 */

import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { attachPtyWebSocketServer } from './server/terminal/pty-ws.js';
import { attachSttWebSocketServer } from './server/stt/stt-ws.js';
import { attachTtsWebSocketServer } from './server/tts/tts-ws.js';
import { destroyAllPtySessions } from './server/terminal/pty-host.js';
import { deleteGenerationsForProviderShutdown } from './server/generations/store.js';
import { getAppRoot } from './server/workspace/root.js';
import { applyMinnowMiddlewares } from './server/runtime/middlewares.js';
import { bootstrapMinnowRuntime } from './server/runtime/bootstrap.js';
import {
  startSchedulerTickLoop,
  stopSchedulerTickLoop,
} from './server/scheduler/tick.js';
import {
  startCalendarReminderLoop,
  stopCalendarReminderLoop,
} from './server/calendar/reminders.js';
import { startEmailPollLoop, stopEmailPollLoop } from './server/email/poller.js';
import { setSchedulerServerBaseUrl } from './server/scheduler/server-base-url.js';
import { shutdownSchedulerRuns } from './server/scheduler/runner.js';
import { shutdownAllServers } from './server/servers/index.js';
import { shutdownAllModelServes } from './server/models/index.js';
import {
  resolveSafePath,
  runWithPathAccess,
} from './server/runtime/path-access.js';
import { spawnElectronShell } from './scripts/spawn-electron.mjs';

const PORT = Number(process.env.PORT) || 5173;

/** Open default browser for the dev URL (platform-specific). */
function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;

  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function main() {
  const appRoot = getAppRoot();
  const vite = await createServer({
    configFile: path.join(appRoot, 'vite.config.ts'),
    server: {
      port: PORT,
      strictPort: false,
    },
    plugins: [
      {
        name: 'minnow-api',
        configureServer(server) {
          if (server.httpServer) {
            attachPtyWebSocketServer(server.httpServer);
            attachSttWebSocketServer(server.httpServer);
            attachTtsWebSocketServer(server.httpServer);
          }
          applyMinnowMiddlewares(server.middlewares, {
            resolveSafePath,
            runWithPathAccess,
          });
        },
      },
    ],
  });

  const { workspacePath, homePath, reefSyncCount } = await bootstrapMinnowRuntime();
  if (reefSyncCount > 0) {
    console.log(`Reef widgets: synced ${reefSyncCount} template(s)`);
  }
  console.log(`Workspace: ${workspacePath}`);
  console.log(`Minnow data: ${homePath}`);

  await vite.listen();
  const urls = vite.resolvedUrls?.local ?? [`http://localhost:${PORT}/`];
  const localUrl = urls[0];
  console.log(`Minnow dev server: ${localUrl}`);
  console.log(`Config API: ${localUrl.replace(/\/$/, '')}/api/config/ping`);
  console.log(`Providers API: ${localUrl.replace(/\/$/, '')}/api/providers`);
  console.log(`Generations API: ${localUrl.replace(/\/$/, '')}/api/generations`);
  console.log(`Research API: ${localUrl.replace(/\/$/, '')}/api/research`);
  console.log(`Work agents API: ${localUrl.replace(/\/$/, '')}/api/work-agents`);
  console.log(`Agent packs API: ${localUrl.replace(/\/$/, '')}/api/agent-packs`);
  console.log(`Tools API: ${localUrl.replace(/\/$/, '')}/api/tools/ping`);
  console.log(`Memory API: ${localUrl.replace(/\/$/, '')}/api/memory/ping`);
  console.log(`Models API: ${localUrl.replace(/\/$/, '')}/api/models/ping`);
  console.log(`LSP API: ${localUrl.replace(/\/$/, '')}/api/lsp/status`);
  console.log(`MCP API: ${localUrl.replace(/\/$/, '')}/api/mcp/ping`);
  console.log(`Servers API: ${localUrl.replace(/\/$/, '')}/api/servers/ping`);
  console.log(`Skills API: ${localUrl.replace(/\/$/, '')}/api/skills`);
  console.log(`Preview API: ${localUrl.replace(/\/$/, '')}/api/preview/ping`);
  console.log(`Terminal API: ${localUrl.replace(/\/$/, '')}/api/terminal/run`);
  console.log(`Terminal PTY: ${localUrl.replace(/\/$/, '')}/api/terminal/ws?sessionId=…`);
  console.log(`Scheduler API: ${localUrl.replace(/\/$/, '')}/api/scheduler/ping`);
  console.log(`Calendar API: ${localUrl.replace(/\/$/, '')}/api/calendar/ping`);
  console.log(`Email API: ${localUrl.replace(/\/$/, '')}/api/email/ping`);
  const schedulerBaseUrl = localUrl.replace(/\/$/, '');
  setSchedulerServerBaseUrl(schedulerBaseUrl);
  await startSchedulerTickLoop({ baseUrl: schedulerBaseUrl });
  startCalendarReminderLoop();
  startEmailPollLoop();
  const onShutdown = () => {
    stopSchedulerTickLoop();
    stopCalendarReminderLoop();
    stopEmailPollLoop();
    shutdownSchedulerRuns();
    shutdownAllServers();
    shutdownAllModelServes();
    destroyAllPtySessions();
    deleteGenerationsForProviderShutdown();
  };
  process.on('exit', onShutdown);
  process.on('SIGINT', () => {
    onShutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    onShutdown();
    process.exit(0);
  });
  // Skip auto-open for CI / headless CLI / when Electron is already the host.
  if (process.env.MINNOW_HEADLESS === '1') {
    console.log('Headless: UI auto-open skipped (MINNOW_HEADLESS=1)');
  } else if (process.env.BROWSER === 'none' || process.env.MINNOW_ELECTRON === '1') {
    /* explicit no UI */
  } else if (process.env.MINNOW_BROWSER === '1') {
    openBrowser(localUrl);
    console.log('Opened in system browser (MINNOW_BROWSER=1). Built-in Chromium preview uses the Electron shell by default.');
  } else {
    const port = new URL(localUrl).port || String(PORT);
    void spawnElectronShell({ port, dev: true, foreground: false })
      .then(() => {
        console.log('Minnow desktop: Electron shell launched (Chromium in-app browser).');
        console.log('Use MINNOW_BROWSER=1 to open the system browser instead.');
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[minnow] Electron launch failed (${message}); opening system browser.`);
        openBrowser(localUrl);
      });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
