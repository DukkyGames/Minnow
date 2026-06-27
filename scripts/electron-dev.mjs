#!/usr/bin/env node
/**
 * Wait for Vite, then launch Electron (used by npm run electron:dev).
 * Avoids fragile && chains under concurrently on Windows.
 */

import { spawnElectronShell } from './spawn-electron.mjs';
import { waitForMinnowDev } from './wait-for-minnow-dev.mjs';

async function main() {
  const { origin, port } = await waitForMinnowDev();
  const devUrl = `${origin}/`;
  console.log(`[electron:dev] Minnow dev server ready at ${devUrl}`);

  console.log('[electron:dev] Launching Electron…');
  const child = await spawnElectronShell({
    port,
    devUrl,
    dev: true,
    foreground: true,
  });
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
