#!/usr/bin/env node
/**
 * Discover and run node:test files under test/.
 *
 * Usage:
 *   node test/run-all.mjs              # full suite
 *   node test/run-all.mjs --suite memory
 *   node test/run-all.mjs --list       # print discovered files
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  groupByRunner,
  listTestsForSuite,
  resolveRunner,
  RUNNERS,
  suitePostCommands,
} from './test-discovery.mjs';

function parseArgs(argv) {
  let suite = null;
  let listOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') {
      listOnly = true;
    } else if (arg === '--suite') {
      suite = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--suite=')) {
      suite = arg.slice('--suite='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return { suite, listOnly };
}

function printHelp() {
  console.log(`Usage: node test/run-all.mjs [--suite <name>] [--list]

Runs all discoverable test/**/*.test.{js,mjs,mts,ts} files, grouped by runner profile.
Orphan detection: npm run test:check-coverage`);
}

/** Stay under Windows CreateProcess command-line limits when batching files. */
const MAX_FILES_PER_BATCH = process.platform === 'win32' ? 20 : 80;

function chunkFiles(files) {
  const chunks = [];
  for (let i = 0; i < files.length; i += MAX_FILES_PER_BATCH) {
    chunks.push(files.slice(i, i + MAX_FILES_PER_BATCH));
  }
  return chunks;
}

function runBatch(runnerId, files) {
  const profile = RUNNERS[runnerId];
  if (!profile) {
    console.error(`Unknown runner profile: ${runnerId}`);
    return 1;
  }

  let exitCode = 0;
  const chunks = chunkFiles(files);

  for (const [index, chunk] of chunks.entries()) {
    const label =
      chunks.length === 1
        ? `${runnerId} (${chunk.length} file${chunk.length === 1 ? '' : 's'})`
        : `${runnerId} batch ${index + 1}/${chunks.length} (${chunk.length} files)`;
    console.log(`\n▶ ${label}`);

    const args = [...profile.prefixArgs, ...chunk];
    const result = spawnSync(profile.command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: process.cwd(),
    });

    if (result.error) {
      console.error(result.error.message);
      exitCode = 1;
      continue;
    }
    if ((result.status ?? 1) !== 0) exitCode = result.status ?? 1;
  }

  return exitCode;
}

function runShellCommand(command) {
  console.log(`\n▶ post: ${command}`);
  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    cwd: process.cwd(),
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function main() {
  const { suite, listOnly } = parseArgs(process.argv.slice(2));
  const files = listTestsForSuite(suite);

  if (listOnly) {
    for (const file of files) {
      console.log(`${file}\t${resolveRunner(file)}`);
    }
    return;
  }

  if (files.length === 0) {
    console.error(suite ? `No tests matched suite "${suite}".` : 'No tests discovered.');
    process.exit(1);
  }

  const groups = groupByRunner(files);
  const runnerOrder = ['node', 'tsx-mocks', 'tsx-loader-mocks', 'tsx', 'node-tsx'];

  let exitCode = 0;
  for (const runnerId of runnerOrder) {
    const batch = groups.get(runnerId);
    if (!batch?.length) continue;
    const code = runBatch(runnerId, batch);
    if (code !== 0) exitCode = code;
  }

  for (const [runnerId, batch] of groups) {
    if (runnerOrder.includes(runnerId)) continue;
    const code = runBatch(runnerId, batch);
    if (code !== 0) exitCode = code;
  }

  for (const command of suitePostCommands(suite)) {
    const code = runShellCommand(command);
    if (code !== 0) exitCode = code;
  }

  process.exit(exitCode);
}

main();
