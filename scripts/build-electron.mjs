#!/usr/bin/env node
/**
 * Compile the Electron main/preload (tsc + preload .mjs rename).
 * Also builds the Session Engine bundle (build-engine-bundle.mjs) so packaged
 * Electron can load the engine without tsx hooks.
 * Shared by postinstall, spawn-electron, and npm run electron:build.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const renameScript = path.join(repoRoot, 'scripts', 'rename-preload-mjs.mjs');
const engineBundleScript = path.join(repoRoot, 'scripts', 'build-engine-bundle.mjs');

/**
 * Run tsc for electron/ and rename preload.js → preload.mjs.
 * @param {{ stdio?: 'inherit' | 'pipe' | 'ignore' }} [options]
 */
export function buildElectronMain(options = {}) {
  const stdio = options.stdio ?? 'inherit';

  if (!fs.existsSync(tscBin)) {
    throw new Error('TypeScript is not installed. Run: npm install');
  }

  const compile = spawnSync(process.execPath, [tscBin, '-p', 'electron/tsconfig.json'], {
    cwd: repoRoot,
    stdio,
    env: process.env,
  });
  if (compile.status !== 0) {
    throw new Error(`Electron compile failed (exit ${compile.status ?? 'unknown'})`);
  }

  const rename = spawnSync(process.execPath, [renameScript], {
    cwd: repoRoot,
    stdio,
    env: process.env,
  });
  if (rename.status !== 0) {
    throw new Error(`Electron preload rename failed (exit ${rename.status ?? 'unknown'})`);
  }

  // Build the Session Engine bundle so packaged builds can load the engine
  // without tsx hooks (no --import tsx required in production).
  const engineBundle = spawnSync(process.execPath, [engineBundleScript], {
    cwd: repoRoot,
    stdio,
    env: process.env,
  });
  if (engineBundle.status !== 0) {
    throw new Error(`Engine bundle build failed (exit ${engineBundle.status ?? 'unknown'})`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    buildElectronMain();
  } catch (err) {
    console.error('[build-electron]', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
