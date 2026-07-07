#!/usr/bin/env node
/**
 * Wait for Vite, then launch Electron — runs in a separate Node process so
 * fetch() does not deadlock the in-process Vite dev server in server.js.
 */

import { spawnElectronShell } from './spawn-electron.mjs';
import { waitForMinnowDev } from './wait-for-minnow-dev.mjs';
import { openBrowser } from './open-browser.mjs';
import { resolveMinnowPort } from '../server/constants/minnow-port.js';
import { readDevHostState } from '../server/runtime/dev-host-state.js';

function readPortArg() {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    return Number(process.argv[idx + 1]);
  }
  return resolveMinnowPort();
}

const preferredPort = readPortArg();

try {
  console.log(`[electron] Waiting for Minnow dev server near port ${preferredPort}…`);
  const { origin, port } = await waitForMinnowDev({ preferredPort });
  const devUrl = `${origin}/`;
  await spawnElectronShell({ port, devUrl, dev: true, foreground: false });
  console.log(`Minnow desktop: Electron shell launched (${devUrl}).`);
  console.log('Use MINNOW_BROWSER=1 to open the system browser instead.');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[electron] Launch failed: ${message}`);
  const fallbackUrl =
    readDevHostState()?.localUrl ?? `http://localhost:${preferredPort}/`;
  console.warn(`[minnow] Opening system browser at ${fallbackUrl}`);
  openBrowser(fallbackUrl);
  process.exit(1);
}
