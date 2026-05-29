#!/usr/bin/env node
/**
 * Wait for Vite, compile electron/, then launch Electron (used by npm run electron:dev).
 * Avoids fragile && chains under concurrently on Windows.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT || '5173';
const devUrl = `http://127.0.0.1:${port}/`;

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

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

  console.log('[electron:dev] Compiling main process…');
  await run('npm', ['run', 'electron:build']);

  const electronBin =
    process.platform === 'win32'
      ? path.join(repoRoot, 'node_modules', '.bin', 'electron.cmd')
      : path.join(repoRoot, 'node_modules', '.bin', 'electron');

  const mainJs = path.join(repoRoot, 'electron', 'dist', 'main.js');
  const env = {
    ...process.env,
    MINNOW_ELECTRON: '1',
    MINNOW_ELECTRON_DEV: '1',
  };

  console.log('[electron:dev] Launching Electron…');
  await run(electronBin, [mainJs], env);
}

main().catch((err) => {
  console.error('[electron:dev]', err.message || err);
  process.exit(1);
});
