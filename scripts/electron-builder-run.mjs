#!/usr/bin/env node
/**
 * Run electron-builder after optional clean. Uses a fresh output dir if the default
 * win-unpacked tree is locked (common on Windows when Minnow.exe or Explorer holds app.asar).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronBuilderSigningArgs } from './macos-signing-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultOut = path.join(repoRoot, 'release', 'pkg');
const winUnpacked = path.join(defaultOut, 'win-unpacked');

// Fail before asar packing if the server imports a src/ file that is not in build.files.
// package:win / package:linux skip npm's prepackage hook, so this must live here.
const validate = spawnSync('node', ['scripts/validate-packaged-runtime-files.mjs'], {
  cwd: repoRoot,
  stdio: 'inherit',
});
if (validate.status !== 0) process.exit(validate.status ?? 1);

// Best-effort clean of the current output tree.
spawnSync('node', ['scripts/clean-release.mjs'], { cwd: repoRoot, stdio: 'inherit' });

let outputDir = 'release/pkg';
if (fs.existsSync(winUnpacked)) {
  const alt = `release/pkg-${Date.now()}`;
  console.warn(
    `[package] ${path.relative(repoRoot, winUnpacked)} is still present; writing to ${alt}/ instead.`,
  );
  outputDir = alt;
}

const builderArgs = [
  'electron-builder',
  ...process.argv.slice(2),
  `--config.directories.output=${outputDir}`,
  ...electronBuilderSigningArgs(),
  // Publish config exists only so electron-builder emits latest.yml for the
  // auto-updater; uploading to GitHub Releases stays a manual step (MIN-384).
  '--publish',
  'never',
];

console.log(`[package] Output: ${outputDir}/`);
const result = spawnSync('npx', builderArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
