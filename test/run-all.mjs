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
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  HEAVY_TEST_ISOLATION,
  isHeavyTestPath,
  resolveTestBatchSize,
  resolveTestConcurrency,
} from './test-config.mjs';
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
Orphan detection: npm run test:check-coverage

Safe defaults: one file per node process, concurrency 1. Heavy UI/orchestrate paths
also use --test-isolation=process. Override with MINNOW_TEST_BATCH_SIZE /
MINNOW_TEST_CONCURRENCY when you have spare RAM.`);
}

/** Headroom under Windows CreateProcess's 32767-char command-line limit. */
const ARGV_CHAR_BUDGET = 24_000;

/** Estimate joined argv length (one space between args). */
function estimateArgvLength(args) {
  if (args.length === 0) return 0;
  return args.reduce((sum, arg) => sum + arg.length, 0) + args.length - 1;
}

/**
 * Split files into spawn batches. Heavy paths never share a process with other files.
 * Light paths honor resolveTestBatchSize() and the argv char budget.
 */
export function chunkFiles(files, runnerId, maxFilesPerBatch, concurrency) {
  const profile = RUNNERS[runnerId];
  const fixedPrefix = [
    ...profile.prefixArgs,
    `--test-concurrency=${concurrency}`,
  ];

  const chunks = [];
  let currentChunk = [];

  const flush = () => {
    if (currentChunk.length === 0) return;
    chunks.push(currentChunk);
    currentChunk = [];
  };

  for (const file of files) {
    if (isHeavyTestPath(file)) {
      flush();
      chunks.push([file]);
      continue;
    }

    const nextChunk = [...currentChunk, file];
    const nextLen = estimateArgvLength([...fixedPrefix, ...nextChunk]);
    const overBudget = nextLen > ARGV_CHAR_BUDGET;
    const overCount = nextChunk.length > maxFilesPerBatch;

    if (currentChunk.length > 0 && (overBudget || overCount)) {
      flush();
      currentChunk = [file];
    } else {
      currentChunk = nextChunk;
    }
  }

  flush();
  return chunks;
}

function runChunk(runnerId, chunk, concurrency, label, { testIsolation } = {}) {
  const profile = RUNNERS[runnerId];
  console.log(`\n▶ ${label}`);

  const args = [...profile.prefixArgs];
  if (testIsolation) {
    args.push(`--test-isolation=${testIsolation}`);
  }
  args.push(`--test-concurrency=${concurrency}`, ...chunk);

  const result = spawnSync(profile.command, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function runBatch(runnerId, files) {
  const profile = RUNNERS[runnerId];
  if (!profile) {
    console.error(`Unknown runner profile: ${runnerId}`);
    return 1;
  }

  const concurrency = resolveTestConcurrency();
  const batchSize = resolveTestBatchSize();
  const chunks = chunkFiles(files, runnerId, batchSize, concurrency);
  let exitCode = 0;

  for (const [index, chunk] of chunks.entries()) {
    const soloHeavy = chunk.length === 1 && isHeavyTestPath(chunk[0]);
    const label =
      chunks.length === 1
        ? `${runnerId} (${chunk.length} file${chunk.length === 1 ? '' : 's'})`
        : `${runnerId} batch ${index + 1}/${chunks.length} (${chunk.length} file${chunk.length === 1 ? '' : 's'})`;
    const code = runChunk(runnerId, chunk, concurrency, label, {
      testIsolation: soloHeavy ? HEAVY_TEST_ISOLATION : undefined,
    });
    if (code !== 0) exitCode = code;
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
  const runnerOrder = ['node', 'tsx-mocks', 'tsx-mocks-loader', 'node-tsx'];

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

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main();
}
