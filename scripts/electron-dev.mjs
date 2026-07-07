#!/usr/bin/env node
/**
 * Wait for Vite, then launch Electron (used by npm run electron:dev).
 * Avoids fragile && chains under concurrently on Windows.
 */

import { ensureElectronBuild, spawnElectronShell } from './spawn-electron.mjs';
import { waitForMinnowDev } from './wait-for-minnow-dev.mjs';
import { resolveMinnowPort } from '../server/constants/minnow-port.js';

async function main() {
  const preferredPort = resolveMinnowPort();
  console.log(`[electron:dev] Waiting for Minnow dev server near port ${preferredPort}…`);

  // Compile while Vite cold-starts so the window opens sooner once the server is up.
  const buildPromise = ensureElectronBuild();

  const { origin, port } = await waitForMinnowDev({
    preferredPort,
    logLabel: '[electron:dev]',
  });
  await buildPromise;

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
