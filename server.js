/**
 * Minnow dev server: Vite + /api/* middleware for LM Studio tool execution.
 * Runtime wiring lives in server/runtime/* for reuse by a future Electron HTTP host.
 */

import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { attachPtyWebSocketServer } from './server/terminal/pty-ws.js';
import { destroyAllPtySessions } from './server/terminal/pty-host.js';
import { deleteGenerationsForProviderShutdown } from './server/generations/store.js';
import { getAppRoot } from './server/workspace/root.js';
import { applyMinnowMiddlewares } from './server/runtime/middlewares.js';
import { bootstrapMinnowRuntime } from './server/runtime/bootstrap.js';
import {
  resolveSafePath,
  runWithPathAccess,
} from './server/runtime/path-access.js';

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
  console.log(`Work agents API: ${localUrl.replace(/\/$/, '')}/api/work-agents`);
  console.log(`Agent packs API: ${localUrl.replace(/\/$/, '')}/api/agent-packs`);
  console.log(`Tools API: ${localUrl.replace(/\/$/, '')}/api/tools/ping`);
  console.log(`Memory API: ${localUrl.replace(/\/$/, '')}/api/memory/ping`);
  console.log(`LSP API: ${localUrl.replace(/\/$/, '')}/api/lsp/status`);
  console.log(`MCP API: ${localUrl.replace(/\/$/, '')}/api/mcp/ping`);
  console.log(`Skills API: ${localUrl.replace(/\/$/, '')}/api/skills`);
  console.log(`Preview API: ${localUrl.replace(/\/$/, '')}/api/preview/ping`);
  console.log(`Terminal API: ${localUrl.replace(/\/$/, '')}/api/terminal/run`);
  console.log(`Terminal PTY: ${localUrl.replace(/\/$/, '')}/api/terminal/ws?sessionId=…`);
  process.on('exit', () => {
    destroyAllPtySessions();
    deleteGenerationsForProviderShutdown();
  });
  // Skip auto-open for CI / headless CLI / Electron host.
  if (
    process.env.BROWSER !== 'none' &&
    process.env.MINNOW_HEADLESS !== '1' &&
    process.env.MINNOW_ELECTRON !== '1'
  ) {
    openBrowser(localUrl);
  } else if (process.env.MINNOW_HEADLESS === '1') {
    console.log('Headless: browser auto-open skipped (MINNOW_HEADLESS=1)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
