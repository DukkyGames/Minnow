#!/usr/bin/env node
/**
 * Validate orchestrate board diagnostic JSONL logs against structural invariants.
 *
 * Usage:
 *   node --import tsx scripts/check-board-log.mjs <groupId|path> [--plan plan.json] [--json]
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getMinnowHome } from '../server/config/home.js';
import { checkBoardLog } from '../src/state/board-log-invariants.ts';

/** Invariants skipped when no --plan task graph is supplied. */
const NO_PLAN_SKIP = ['wave-order', 'dependency-order'];

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
 * Mirror server/orchestrate/board-log-sink.js group id sanitization.
 * @param {string} groupId
 */
function sanitizeGroupId(groupId) {
  const trimmed = typeof groupId === 'string' ? groupId.trim() : '';
  if (!trimmed) return null;
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return safe || null;
}

/**
 * @param {string} input
 * @returns {string}
 */
function resolveLogPath(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('groupId or log path is required');
  }
  if (trimmed.endsWith('.bak')) {
    throw new Error('refusing to read rotated backup (*.bak); use the active .jsonl file');
  }

  const looksLikePath =
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.endsWith('.jsonl') ||
    trimmed.startsWith('~') ||
    trimmed.startsWith('.') ||
    path.isAbsolute(trimmed);

  if (looksLikePath) {
    const expanded = trimmed.startsWith('~')
      ? path.join(os.homedir(), trimmed.slice(1).replace(/^[/\\]/, ''))
      : trimmed;
    const resolved = path.resolve(expanded);
    if (resolved.endsWith('.bak')) {
      throw new Error('refusing to read rotated backup (*.bak); use the active .jsonl file');
    }
    return resolved;
  }

  const safe = sanitizeGroupId(trimmed);
  if (!safe) {
    throw new Error(`invalid group id: ${trimmed}`);
  }
  return path.join(getMinnowHome(), 'logs', 'orchestrate', `${safe}.jsonl`);
}

/**
 * Parse JSONL content; tolerate a trailing partial line from rotation.
 * @param {string} content
 * @returns {import('../src/types.ts').BoardLogEvent[]}
 */
function parseJsonl(content) {
  if (!content) return [];
  const lines = content.split('\n');
  /** @type {import('../src/types.ts').BoardLogEvent[]} */
  const events = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') {
        events.push(parsed);
      }
    } catch {
      const isLastLine = i === lines.length - 1;
      if (isLastLine) {
        // Rotation or in-flight append can leave a truncated final line.
        continue;
      }
      console.error(`warning: skipping unparseable JSONL line ${i + 1}`);
    }
  }

  return events;
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
 * @param {string} planPath
 */
async function loadPlan(planPath) {
  const raw = await fs.readFile(path.resolve(planPath), 'utf8');
  const plan = JSON.parse(raw);
  if (!plan || typeof plan !== 'object') {
    throw new Error('--plan JSON must be an object');
  }
  if (!Array.isArray(plan.tasks)) {
    throw new Error('--plan JSON must include a tasks array');
  }
  return plan;
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

/**
 * @param {string} logPath
 * @param {import('../src/state/board-log-invariants.ts').BoardLogCheckOptions} checkOpts
 * @param {{ json: boolean; skippedInvariants: string[] }} outputOpts
 */
async function runCheck(logPath, checkOpts, outputOpts) {
  let content;
  try {
    content = await fs.readFile(logPath, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      throw new Error(`log file not found: ${logPath}`);
    }
    throw err;
  }

  const events = parseJsonl(content);
  const result = checkBoardLog(events, checkOpts);
  const payload = {
    ok: result.ok,
    logPath,
    skippedInvariants: outputOpts.skippedInvariants,
    stats: result.stats,
    violations: result.violations,
  };

  if (outputOpts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return result.ok ? 0 : 1;
  }

  console.log(`Log: ${logPath}`);
  console.log(`Events: ${result.stats.events ?? events.length}`);
  if (outputOpts.skippedInvariants.length > 0) {
    console.log(`Skipped: ${outputOpts.skippedInvariants.join(', ')}`);
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

  const logPath = resolveLogPath(args.target);
  /** @type {import('../src/state/board-log-invariants.ts').BoardLogCheckOptions} */
  const checkOpts = { tasks: [] };
  /** @type {string[]} */
  const skippedInvariants = [];

  if (args.plan) {
    const plan = await loadPlan(args.plan);
    checkOpts.tasks = plan.tasks;
    if (plan.waveOrder) checkOpts.waveOrder = plan.waveOrder;
    if (plan.caps) checkOpts.caps = plan.caps;
    if (plan.expectFinalTest) checkOpts.expectFinalTest = true;
  } else {
    checkOpts.skip = [...NO_PLAN_SKIP];
    skippedInvariants.push(...NO_PLAN_SKIP);
  }

  return runCheck(logPath, checkOpts, { json: args.json, skippedInvariants });
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

export { parseCliArgs, parseJsonl, resolveLogPath, printHelp };
