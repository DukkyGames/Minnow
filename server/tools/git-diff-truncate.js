/**
 * Smart git diff truncation — stat summary, complete file hunks, omitted-file footer (MIN-345).
 */

import { DEFAULT_MAX_OUTPUT_CHARS } from './output-cap.js';
import { parseGitNumstat } from './git-change-stats.js';

/**
 * Extract the file path from a `diff --git a/foo b/foo` header line.
 * @param {string} line
 */
function pathFromDiffHeader(line) {
  const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (!match) return null;
  return match[2] ?? match[1] ?? null;
}

/**
 * Split a unified diff into per-file sections (each starts with `diff --git`).
 * @param {string} patch
 * @returns {Array<{ path: string | null, text: string }>}
 */
export function splitDiffByFile(patch) {
  const lines = String(patch ?? '').split(/\r?\n/);
  /** @type {Array<{ path: string | null, lines: string[] }>} */
  const sections = [];
  /** @type {{ path: string | null, lines: string[] } | null} */
  let current = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current && current.lines.length > 0) {
        sections.push(current);
      }
      current = { path: pathFromDiffHeader(line), lines: [line] };
      continue;
    }
    if (!current) {
      current = { path: null, lines: [] };
    }
    current.lines.push(line);
  }

  if (current && current.lines.length > 0) {
    sections.push(current);
  }

  return sections.map((section) => ({
    path: section.path,
    text: section.lines.join('\n'),
  }));
}

/**
 * Build per-file +/- lookup from numstat rows.
 * @param {{ additions: number, deletions: number, paths: string[] }} numstat
 * @returns {Map<string, { additions: number, deletions: number }>}
 */
function buildPerFileStats(rawNumstat) {
  /** @type {Map<string, { additions: number, deletions: number }>} */
  const map = new Map();
  const rows = String(rawNumstat ?? '').split('\n');
  for (const line of rows) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const addRaw = parts[0];
    const delRaw = parts[1];
    const filePath = parts.slice(2).join('\t').trim();
    if (!filePath || addRaw === '-' || delRaw === '-') continue;
    const additions = Number(addRaw);
    const deletions = Number(delRaw);
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;
    map.set(filePath, { additions, deletions });
  }
  return map;
}

/**
 * Format a stat summary block from numstat metadata.
 * @param {{
 *   staged: boolean,
 *   scopePath?: string,
 *   numstat: { additions: number, deletions: number, paths: string[] },
 *   rawNumstat: string,
 * }} meta
 */
function buildStatHeader(meta) {
  const mode = meta.staged ? 'staged' : 'unstaged';
  const scope = meta.scopePath ? ` (path: ${meta.scopePath})` : '';
  const fileCount = meta.numstat.paths.length;
  const perFileStats = buildPerFileStats(meta.rawNumstat);
  const lines = [
    `Git diff summary (${mode})${scope}: ${fileCount} file(s), +${meta.numstat.additions} -${meta.numstat.deletions}`,
  ];

  for (const filePath of meta.numstat.paths) {
    const stats = perFileStats.get(filePath);
    if (stats) {
      lines.push(`  ${filePath}: +${stats.additions} -${stats.deletions}`);
    } else {
      lines.push(`  ${filePath}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Format omitted-files footer with per-file counts and retry guidance.
 * @param {Array<{ path: string | null, additions: number, deletions: number }>} omitted
 * @param {boolean} staged
 */
function buildOmittedFooter(omitted, staged) {
  if (omitted.length === 0) return '';

  const stagedHint = staged ? ' staged=true' : '';
  const lines = [
    '---',
    `Truncated: omitted ${omitted.length} file(s) — call git_diff with path= for each file${stagedHint}:`,
  ];

  for (const entry of omitted) {
    const label = entry.path ?? '(unknown)';
    if (entry.additions || entry.deletions) {
      lines.push(`  ${label}: +${entry.additions} -${entry.deletions}`);
    } else {
      lines.push(`  ${label}`);
    }
  }

  return lines.join('\n');
}

/**
 * Truncate an oversized git patch while keeping whole per-file hunks.
 * @param {string} patch
 * @param {string} rawNumstat
 * @param {{
 *   maxChars?: number,
 *   staged?: boolean,
 *   scopePath?: string,
 * }} [options]
 * @returns {{ text: string, truncated: boolean, includedFiles: number, omittedFiles: number }}
 */
export function truncateGitDiff(patch, rawNumstat, options = {}) {
  const maxChars = options.maxChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const staged = options.staged === true;
  const scopePath = options.scopePath;
  const trimmedPatch = String(patch ?? '').trimEnd();

  if (trimmedPatch.length <= maxChars) {
    return {
      text: trimmedPatch,
      truncated: false,
      includedFiles: splitDiffByFile(trimmedPatch).length,
      omittedFiles: 0,
    };
  }

  const numstat = parseGitNumstat(rawNumstat);
  const perFileStats = buildPerFileStats({ raw: rawNumstat });
  const header = buildStatHeader({
    staged,
    scopePath,
    numstat,
    rawNumstat,
  });

  const footerReserve = 400;
  const patchBudget = Math.max(0, maxChars - header.length - footerReserve);
  const sections = splitDiffByFile(trimmedPatch);
  const included = [];
  const omitted = [];
  let usedChars = 0;

  for (const section of sections) {
    const sectionText = section.text;
    const addedChars = sectionText.length + (included.length > 0 ? 1 : 0);
    if (usedChars + addedChars <= patchBudget) {
      included.push(sectionText);
      usedChars += addedChars;
      continue;
    }

    const stats = section.path ? perFileStats.get(section.path) : undefined;
    omitted.push({
      path: section.path,
      additions: stats?.additions ?? 0,
      deletions: stats?.deletions ?? 0,
    });
  }

  const footer = buildOmittedFooter(omitted, staged);
  const body = included.join('\n');
  const text = footer ? `${header}\n${body}\n${footer}` : `${header}\n${body}`;

  return {
    text,
    truncated: true,
    includedFiles: included.length,
    omittedFiles: omitted.length,
  };
}
