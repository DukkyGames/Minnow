#!/usr/bin/env node
/**
 * Compile (if needed) and launch the Minnow Electron shell against a running dev server.
 * Used by `npm start` (desktop default) and `scripts/electron-dev.mjs`.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForVite } from './wait-for-vite.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

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

/** Resolve the platform Electron executable (not the .cmd shim). */
function electronBinaryPath() {
  try {
    return require('electron');
  } catch {
    return null;
  }
}

function mainJsPath() {
  return path.join(repoRoot, 'electron', 'dist', 'main.js');
}

function preloadMjsPath() {
  return path.join(repoRoot, 'electron', 'dist', 'preload.mjs');
}

function isElectronBuildReady() {
  return fs.existsSync(mainJsPath()) && fs.existsSync(preloadMjsPath());
}

async function ensureElectronBuild() {
  if (isElectronBuildReady()) return;
  console.log('[electron] Compiling main process (first run)…');
  await run('npm', ['run', 'electron:build']);
  if (!isElectronBuildReady()) {
    throw new Error('Electron build incomplete. Run npm run electron:build.');
  }
}

/**
 * @param {{ port?: number | string, dev?: boolean, foreground?: boolean }} options
 * @returns {import('node:child_process').ChildProcess | null}
 */
export async function spawnElectronShell(options = {}) {
  const port = String(options.port ?? process.env.PORT ?? '5173');
  const dev = options.dev !== false;
  const foreground = options.foreground === true;

  const electronBin = electronBinaryPath();
  if (!electronBin || !fs.existsSync(electronBin)) {
    throw new Error('Electron binary not found. Run npm install.');
  }

  await ensureElectronBuild();

  // Cold Vite starts (especially on a new machine) pre-bundle deps before the first
  // page is servable; launching Electron too early leaves the window hidden forever.
  if (dev) {
    console.log(`[electron] Waiting for Vite on port ${port}…`);
    await waitForVite(port);
  }

  const mainJs = mainJsPath();
  const env = {
    ...process.env,
    PORT: port,
    MINNOW_ELECTRON: '1',
    MINNOW_ELECTRON_DEV: dev ? '1' : '0',
  };

  const args = [mainJs];
  const child = spawn(electronBin, args, {
    cwd: repoRoot,
    env,
    stdio: foreground ? 'inherit' : 'ignore',
    detached: !foreground,
    windowsHide: false,
  });

  child.on('error', (err) => {
    console.error('[electron] Failed to launch:', err.message || err);
  });

  if (!foreground) {
    child.unref();
  }

  return child;
}
