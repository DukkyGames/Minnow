#!/usr/bin/env node
/**
 * Validate orchestrate board diagnostic JSONL logs against structural invariants.
 *
 * Usage:
 *   node --import tsx scripts/check-board-log.mjs <groupId|path> [--plan plan.json] [--json]
 */

import { pathToFileURL } from 'node:url';
import {
  NO_PLAN_SKIP,
  loadPlanFromFile,
  parseJsonl,
  resolveLogPath,
  validateBoardLog,
} from '../server/orchestrate/board-testing/board-log-validate.js';
import { importTsModule } from '../server/orchestrate/board-testing/ts-import.js';

function printHelp() {
  console.log(`Usage: node --import tsx scripts/check-board-log.mjs <groupId|path> [options]

Validate an orchestrate board diagnostic JSONL log against structural invariants.

Arguments:
  groupId|path    Board group id (resolves to ~/.minnow/logs/orchestrate/<id>.jsonl)
                  or a direct path to a .jsonl file

Options:
  --plan <file>   Plan JSON: { tasks: [{id, wave?, dependsOn?}], waveOrder?, caps?, expectFinalTest? }
  --json          Emit machine-readable JSON (for CI)
  --help, -h      Show this help

Without --plan, wave-order and dependency-order invariants are skipped (no task graph).
Trailing partial JSONL lines are ignored (rotation / in-flight append). Rotated *.bak
files are not read — pass the active .jsonl file or a group id.

Exit codes: 0 when all checked invariants pass, 1 on violations or errors.
`);
}

/**
 * @param {string[]} argv
 */
function parseCliArgs(argv) {
  /** @type {{ target?: string; plan?: string; json: boolean; help: boolean }} */
  const out = { json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--plan') {
      const next = argv[i + 1];
      if (!next) throw new Error('--plan requires a path');
      out.plan = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`unknown argument: ${arg}`);
    }
    if (out.target) {
      throw new Error(`unexpected extra argument: ${arg}`);
    }
    out.target = arg;
  }

  return out;
}

/**
 * @param {import('../src/state/board-log-invariants.ts').BoardLogViolation[]} violations
 */
function printViolationTable(violations) {
  const headers = ['Invariant', 'Task', 'Event', 'Message'];
  const rows = violations.map((v) => [
    v.id,
    v.taskId ?? '',
    v.eventId ?? '',
    v.message,
  ]);

  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => row[col].length)),
  );

  const sep = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  const fmt = (cells) =>
    cells.map((cell, col) => ` ${cell.padEnd(widths[col])} `).join('│');

  console.log(fmt(headers));
  console.log(sep);
  for (const row of rows) {
    console.log(fmt(row));
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.target) {
    printHelp();
    return 1;
  }

  const plan = args.plan ? await loadPlanFromFile(args.plan) : undefined;
  const result = await validateBoardLog({
    groupId: args.target,
    plan,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  console.log(`Log: ${result.logPath}`);
  console.log(`Events: ${result.eventsCount}`);
  if (result.skippedInvariants.length > 0) {
    console.log(`Skipped: ${result.skippedInvariants.join(', ')}`);
  }

  if (result.ok) {
    console.log('OK — all checked invariants passed');
    return 0;
  }

  console.log(`Violations: ${result.violations.length}`);
  console.log('');
  printViolationTable(result.violations);
  return 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}

export { parseCliArgs, parseJsonl, resolveLogPath, printHelp, importTsModule, NO_PLAN_SKIP };
