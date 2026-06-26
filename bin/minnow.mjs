#!/usr/bin/env node
/**
 * Minnow headless CLI — delegates to TypeScript runner via tsx.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const runner = path.join(root, 'src', 'headless', 'cli-main.ts');

const argv = process.argv.slice(2);

if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
  process.stderr.write(`Minnow headless CLI

Usage:
  minnow run [options]     Run one agent turn (see: minnow run --help)

Examples:
  minnow run --prompt "Summarize README.md" --workspace .
  BROWSER=none npm start &
  minnow run --base-url http://127.0.0.1:9473 --prompt "Reply OK" --json
`);
  process.exit(0);
}

if (!fs.existsSync(tsxCli)) {
  process.stderr.write('Error: tsx is required. Run npm install in the Minnow repo.\n');
  process.exit(2);
}

// Node's --import hook requires file:// URLs on Windows (bare C:\ paths fail with ERR_UNSUPPORTED_ESM_URL_SCHEME).
const testLoader = pathToFileURL(path.join(root, 'test', 'test-loader.mjs')).href;
const tsxArgs = [tsxCli, '--import', testLoader, runner, ...argv];

const result = spawnSync(process.execPath, tsxArgs, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
