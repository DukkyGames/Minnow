/**
 * Reusable board diagnostic JSONL validation for CLI and HTTP API.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getMinnowHome } from '../../config/home.js';
import { importTsModule } from './ts-import.js';

/** Invariants skipped when no plan task graph is supplied. */
export const NO_PLAN_SKIP = ['wave-order', 'dependency-order'];

/**
 * Mirror server/orchestrate/board-log-sink.js group id sanitization.
 * @param {string} groupId
 */
export function sanitizeGroupId(groupId) {
  const trimmed = typeof groupId === 'string' ? groupId.trim() : '';
  if (!trimmed) return null;
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return safe || null;
}

/**
 * @param {string} input
 * @returns {string}
 */
export function resolveLogPath(input) {
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
 * @returns {import('../../../src/types.ts').BoardLogEvent[]}
 */
export function parseJsonl(content) {
  if (!content) return [];
  const lines = content.split('\n');
  /** @type {import('../../../src/types.ts').BoardLogEvent[]} */
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
        continue;
      }
    }
  }

  return events;
}

/**
 * @param {string} planPath
 */
export async function loadPlanFromFile(planPath) {
  const raw = await fs.readFile(path.resolve(planPath), 'utf8');
  return parsePlanObject(JSON.parse(raw));
}

/**
 * @param {unknown} plan
 */
export function parsePlanObject(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('plan JSON must be an object');
  }
  if (!Array.isArray(/** @type {{ tasks?: unknown }} */ (plan).tasks)) {
    throw new Error('plan JSON must include a tasks array');
  }
  return /** @type {{ tasks: unknown[]; waveOrder?: unknown; caps?: unknown; expectFinalTest?: boolean }} */ (
    plan
  );
}

/**
 * @param {{ groupId: string; plan?: unknown; planPath?: string }} options
 */
export async function validateBoardLog(options) {
  const groupId = typeof options.groupId === 'string' ? options.groupId.trim() : '';
  if (!groupId) {
    throw new Error('groupId is required');
  }

  const logPath = resolveLogPath(groupId);
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
  const { checkBoardLog } = await importTsModule(
    '../../../src/state/board-log-invariants.ts',
  );

  /** @type {import('../../../src/state/board-log-invariants.ts').BoardLogCheckOptions} */
  const checkOpts = { tasks: [] };
  /** @type {string[]} */
  const skippedInvariants = [];

  if (options.plan != null) {
    const plan = parsePlanObject(options.plan);
    checkOpts.tasks = /** @type {import('../../../src/types.ts').BoardTask[]} */ (plan.tasks);
    if (plan.waveOrder) checkOpts.waveOrder = plan.waveOrder;
    if (plan.caps) checkOpts.caps = plan.caps;
    if (plan.expectFinalTest) checkOpts.expectFinalTest = true;
  } else if (options.planPath) {
    const plan = await loadPlanFromFile(options.planPath);
    checkOpts.tasks = /** @type {import('../../../src/types.ts').BoardTask[]} */ (plan.tasks);
    if (plan.waveOrder) checkOpts.waveOrder = plan.waveOrder;
    if (plan.caps) checkOpts.caps = plan.caps;
    if (plan.expectFinalTest) checkOpts.expectFinalTest = true;
  } else {
    checkOpts.skip = [...NO_PLAN_SKIP];
    skippedInvariants.push(...NO_PLAN_SKIP);
  }

  const result = checkBoardLog(events, checkOpts);
  return {
    ok: result.ok,
    logPath,
    eventsCount: result.stats.events ?? events.length,
    skippedInvariants,
    stats: result.stats,
    violations: result.violations,
  };
}
