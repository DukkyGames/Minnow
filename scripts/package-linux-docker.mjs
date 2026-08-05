#!/usr/bin/env node
/**
 * Build a Linux AppImage on Windows/macOS via electronuserland/builder (Docker).
 * On native Linux, use `npm run package:linux` instead.
 *
 * Requires Docker. Runs `npm ci` inside the container with a Linux node_modules
 * volume so native addons (better-sqlite3, node-pty) match the target OS.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = 'release/pkg-linux';
const image = 'electronuserland/builder:22';

const dockerArgs = [
  'run',
  '--rm',
  `-v=${repoRoot}:/project`,
  '-v=minnow-linux-node-modules:/project/node_modules',
  '-w=/project',
  image,
  'bash',
  '-c',
  [
    'npm ci',
    'npm run sandbox:build-helper',
    'npm run build',
    'npm run electron:build',
    `npx electron-builder --linux AppImage --publish never --config.directories.output=${outputDir}`,
  ].join(' && '),
];

console.log(`[package:linux:docker] image=${image} output=${outputDir}/`);
const result = spawnSync('docker', dockerArgs, { cwd: repoRoot, stdio: 'inherit' });
process.exit(result.status ?? 1);
