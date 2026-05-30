#!/usr/bin/env node
/**
 * Stop Minnow / Electron processes that lock release/win-unpacked (Windows packaging).
 * Safe no-op on other platforms when taskkill is unavailable.
 */

import { execSync } from 'node:child_process';

const isWin = process.platform === 'win32';

function tryExec(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
  } catch {
    // Process not running or command unavailable.
  }
}

if (isWin) {
  for (const image of ['Minnow.exe', 'electron.exe']) {
    tryExec(`taskkill /F /IM ${image} /T`);
  }
} else {
  for (const pattern of ['Minnow', 'electron']) {
    tryExec(`pkill -f "${pattern}" 2>/dev/null || true`);
  }
}
