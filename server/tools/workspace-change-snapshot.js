/**
 * Workspace change detection for execute_command via git numstat snapshots
 * and best-effort single-file heuristics (sed, redirects, patch).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { runProcess } from '../process-runner.js';
import {
  buildCodeChangePayload,
  codeChangeFromDiff,
  countLineChangeStats,
} from './line-diff-stats.js';
import { gitWorkingTreeNumstat, isGitRepository, parseGitNumstat } from './git-change-stats.js';

/**
 * @typedef {{ additions: number; deletions: number; paths: string[] }} NumstatTotals
 */

/**
 * Capture git working-tree numstat when available.
 * @param {string} cwd
 * @returns {Promise<NumstatTotals | null>}
 */
export async function captureWorkspaceSnapshot(cwd) {
  if (!(await isGitRepository(cwd))) return null;
  return gitWorkingTreeNumstat(cwd);
}

/**
 * Delta between two numstat snapshots (paths union, stats subtracted per path best-effort).
 * @param {NumstatTotals | null} before
 * @param {NumstatTotals | null} after
 * @returns {NumstatTotals}
 */
export function diffNumstatSnapshots(before, after) {
  const afterPaths = new Set(after?.paths ?? []);
  const beforePaths = new Set(before?.paths ?? []);
  const allPaths = new Set([...afterPaths, ...beforePaths]);
  let additions = 0;
  let deletions = 0;
  const paths = [];

  const afterAdd = (after?.additions ?? 0) - (before?.additions ?? 0);
  const afterDel = (after?.deletions ?? 0) - (before?.deletions ?? 0);

  if (afterAdd > 0 || afterDel > 0) {
    additions = Math.max(0, afterAdd);
    deletions = Math.max(0, afterDel);
    for (const p of allPaths) paths.push(p);
  }

  return { additions, deletions, paths };
}

/**
 * After command: compute workspace codeChange from git snapshot delta.
 * @param {string} cwd
 * @param {NumstatTotals | null} before
 */
export async function codeChangeFromCommandSnapshot(cwd, before) {
  const after = await captureWorkspaceSnapshot(cwd);
  if (!after) return undefined;
  const delta = diffNumstatSnapshots(before, after);
  if (delta.additions === 0 && delta.deletions === 0) return undefined;
  return buildCodeChangePayload({
    additions: delta.additions,
    deletions: delta.deletions,
    paths: delta.paths.length ? delta.paths : after.paths,
    source: 'command-snapshot',
  });
}

/** Resolve a single relative path from command string heuristics. */
function extractHeuristicTargetPath(command) {
  const cmd = String(command ?? '');
  const patterns = [
    /\bsed\s+(?:-[^\s]+\s+)*['"]?([^'"\s|>]+)['"]?/i,
    /\bpatch\s+(?:-[^\s]+\s+)*['"]?([^'"\s]+)['"]?/i,
    /\bgit\s+apply\s+['"]?([^'"\s]+)['"]?/i,
    /(?:^|[\s|])(?:>>?)\s*['"]?([^\s'"]+)['"]?/,
    /\bOut-File\s+(?:-[^\s]+\s+)*['"]?([^'"\s]+)['"]?/i,
    /\bSet-Content\s+(?:-[^\s]+\s+)*['"]?([^'"\s]+)['"]?/i,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    if (m?.[1] && !m[1].startsWith('/dev/')) return m[1];
  }
  return null;
}

/**
 * Best-effort before/after diff for a single file touched by shell one-liners.
 * @param {string} cwd
 * @param {string} command
 * @param {Map<string, string>} beforeContents path → utf8 snapshot
 */
export async function codeChangeFromCommandHeuristic(cwd, command, beforeContents) {
  const rel = extractHeuristicTargetPath(command);
  if (!rel) return undefined;

  const abs = path.resolve(cwd, rel);
  const before = beforeContents.get(rel) ?? '';
  let after = '';
  try {
    after = await fs.readFile(abs, 'utf8');
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
    if (code !== 'ENOENT') return undefined;
    after = '';
  }

  const change = codeChangeFromDiff(before, after, rel.replace(/\\/g, '/'), {
    source: 'command-heuristic',
  });
  if (!change) return undefined;
  change.source = 'command-heuristic';
  return change;
}

/**
 * Read file contents for heuristic snapshot (ignore errors).
 * @param {string} cwd
 * @param {string} relPath
 */
export async function readHeuristicFileSnapshot(cwd, relPath) {
  try {
    const abs = path.resolve(cwd, relPath);
    return await fs.readFile(abs, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Combine git snapshot delta with optional heuristic when git unavailable.
 * @param {object} params
 * @param {string} params.cwd
 * @param {string} params.command
 * @param {NumstatTotals | null} params.beforeSnapshot
 * @param {Map<string, string>} [params.beforeFileContents]
 */
export async function resolveExecuteCommandCodeChange({
  cwd,
  command,
  beforeSnapshot,
  beforeFileContents,
}) {
  const fromGit = await codeChangeFromCommandSnapshot(cwd, beforeSnapshot);
  if (fromGit) return fromGit;

  const rel = extractHeuristicTargetPath(command);
  if (!rel || !beforeFileContents) return undefined;
  return codeChangeFromCommandHeuristic(cwd, command, beforeFileContents);
}

/** Export for tests: line stats without full payload. */
export { countLineChangeStats, parseGitNumstat };
