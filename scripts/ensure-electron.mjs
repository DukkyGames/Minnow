/**
 * Eagerly downloads the Electron binary during npm install.
 * Electron 42+ no longer runs install.js automatically on package install.
 *
 * Env:
 *   MINNOW_SKIP_ELECTRON=1  — skip download (CI / headless)
 *   MINNOW_HEADLESS=1       — same as MINNOW_SKIP_ELECTRON
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_INSTALL_JS = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'install.js');

/**
 * @returns {boolean}
 */
function shouldSkip() {
  return process.env.MINNOW_SKIP_ELECTRON === '1' || process.env.MINNOW_HEADLESS === '1';
}

/**
 * @param {string} message
 */
function warn(message) {
  console.warn(`[ensure-electron] ${message}`);
}

/**
 * @param {string} message
 */
function log(message) {
  console.log(`[ensure-electron] ${message}`);
}

function main() {
  if (shouldSkip()) {
    log('Skipping Electron binary download (MINNOW_SKIP_ELECTRON or MINNOW_HEADLESS is set).');
    return;
  }

  if (!fs.existsSync(ELECTRON_INSTALL_JS)) {
    warn(
      'Electron package not found. The default `npm start` desktop shell requires it. Run: npm install',
    );
    return;
  }

  log('Ensuring Electron binary is downloaded…');
  const result = spawnSync(process.execPath, [ELECTRON_INSTALL_JS], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    warn(`Electron binary download failed (exit ${result.status ?? 'unknown'}).`);
    warn('Retry with: npm install electron');
    process.exit(result.status ?? 1);
  }

  log('Electron binary ready.');
}

main();
