#!/usr/bin/env node
/**
 * Wait for Vite, then launch Electron — runs in a separate Node process so
 * fetch() does not deadlock the in-process Vite dev server in server.js.
 */

import { spawnElectronShell } from './spawn-electron.mjs';
import { waitForVite } from './wait-for-vite.mjs';

function readPortArg() {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return process.env.PORT || '5173';
}

const port = readPortArg();

try {
  console.log(`[electron] Waiting for Vite on port ${port}…`);
  await waitForVite(port);
  await spawnElectronShell({ port, dev: true, foreground: false });
  console.log('Minnow desktop: Electron shell launched (Chromium in-app browser).');
  console.log('Use MINNOW_BROWSER=1 to open the system browser instead.');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[electron] Launch failed: ${message}`);
  process.exit(1);
}
