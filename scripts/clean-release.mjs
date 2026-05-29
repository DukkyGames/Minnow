#!/usr/bin/env node
/**
 * Remove release/win-unpacked before electron-builder repackages (avoids app.asar lock on Windows).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const winUnpackedDirs = [
  path.join(repoRoot, 'release', 'pkg', 'win-unpacked'),
  path.join(repoRoot, 'release', 'win-unpacked'),
];

// Kill packaged / dev Electron instances that hold app.asar open.
execSync(`node "${path.join(repoRoot, 'scripts', 'kill-minnow-processes.mjs')}"`, {
  stdio: 'inherit',
  cwd: repoRoot,
});

/** Prefer delete; on Windows fall back to rename when app.asar is still open (Explorer, AV, etc.). */
async function clearWinUnpacked(winUnpacked) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.rmSync(winUnpacked, { recursive: true, force: true });
      if (!fs.existsSync(winUnpacked)) {
        console.log('Removed release/win-unpacked');
        return;
      }
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? err.code : '';
      if (attempt < maxAttempts && (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY')) {
        console.warn(
          `release/win-unpacked is locked (attempt ${attempt}/${maxAttempts}); retrying in 1s…`,
        );
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    }
  }

  const staleDir = path.join(
    repoRoot,
    'release',
    `win-unpacked-stale-${Date.now()}`,
  );
  try {
    fs.renameSync(winUnpacked, staleDir);
    console.log(`Renamed locked folder to ${path.relative(repoRoot, staleDir)}`);
    console.log('Delete stale folders under release/ when nothing is using them.');
    return;
  } catch (renameErr) {
    console.warn(
      `Could not remove or rename ${path.relative(repoRoot, winUnpacked)} (still locked).`,
    );
    console.warn(
      'Close Minnow.exe, Explorer windows on release/, or ignore if packaging uses a fresh output folder.',
    );
    console.warn(renameErr.message || renameErr);
  }
}

for (const winUnpacked of winUnpackedDirs) {
  if (fs.existsSync(winUnpacked)) {
    await clearWinUnpacked(winUnpacked);
  }
}
