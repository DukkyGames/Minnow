#!/usr/bin/env node
/**
 * Wait for Vite, then launch Electron (used by npm run electron:dev).
 * Avoids fragile && chains under concurrently on Windows.
 */

import { spawnElectronShell } from './spawn-electron.mjs';
import { waitForVite } from './wait-for-vite.mjs';

const port = process.env.PORT || '5173';
const devUrl = `http://localhost:${port}/`;

async function main() {
  console.log(`[electron:dev] Waiting for ${devUrl}…`);
  await waitForVite(port);

  console.log('[electron:dev] Launching Electron…');
  const child = await spawnElectronShell({ port, dev: true, foreground: true });
  if (!child) {
    throw new Error('Electron did not start');
  }
  await new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron exited with ${code}`));
    });
  });
}

main().catch((err) => {
  console.error('[electron:dev]', err.message || err);
  process.exit(1);
});
