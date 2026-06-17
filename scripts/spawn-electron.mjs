#!/usr/bin/env node
/**
 * Compile (if needed) and launch the Minnow Electron shell against a running dev server.
 * Used by `npm start` (desktop default) and `scripts/electron-dev.mjs`.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function electronPackageDir() {
  return path.join(repoRoot, 'node_modules', 'electron');
}

function electronBinaryPath() {
  return process.platform === 'win32'
    ? path.join(repoRoot, 'node_modules', '.bin', 'electron.cmd')
    : path.join(repoRoot, 'node_modules', '.bin', 'electron');
}

function electronDistBinaryPath() {
  const electronDir = electronPackageDir();
  if (process.platform === 'win32') {
    return path.join(electronDir, 'dist', 'electron.exe');
  }
  if (process.platform === 'darwin') {
    return path.join(electronDir, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }
  return path.join(electronDir, 'dist', 'electron');
}

function electronInstallError() {
  const electronDir = electronPackageDir();
  if (!fs.existsSync(electronDir)) {
    const productionHint =
      process.env.NODE_ENV === 'production' ? ' or `npm install electron` if using `--omit=dev`' : '';
    return new Error(`Electron is not installed. Run: npm install${productionHint}`);
  }

  return new Error(
    'Electron binary not downloaded. Run: npm install (re-runs postinstall) or `node scripts/ensure-electron.mjs`',
  );
}

function mainJsPath() {
  return path.join(repoRoot, 'electron', 'dist', 'main.js');
}

async function ensureElectronBuild() {
  const mainJs = mainJsPath();
  if (fs.existsSync(mainJs)) return;
  console.log('[electron] Compiling main process…');
  await run('npm', ['run', 'electron:build']);
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
  const electronDist = electronDistBinaryPath();
  if (!fs.existsSync(electronBin) || !fs.existsSync(electronDist)) {
    throw electronInstallError();
  }

  await ensureElectronBuild();

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
    shell: process.platform === 'win32',
  });

  child.on('error', (err) => {
    console.error('[electron] Failed to launch:', err.message || err);
  });

  if (!foreground) {
    child.unref();
  }

  return child;
}
