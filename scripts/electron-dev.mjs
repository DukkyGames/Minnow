#!/usr/bin/env node
/**
 * Wait for Vite, then launch Electron (used by npm run electron:dev).
 * Avoids fragile && chains under concurrently on Windows.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnElectronShell } from './spawn-electron.mjs';

const port = process.env.PORT || '5173';
const devUrl = `http://127.0.0.1:${port}/`;

async function waitForVite() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(devUrl, { method: 'GET' });
      if (res.ok) return;
    } catch {
      // Vite not ready yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for Vite at ${devUrl}`);
}

async function main() {
  console.log(`[electron:dev] Waiting for ${devUrl}…`);
  await waitForVite();

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
