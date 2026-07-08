/**
 * Workspace-scoped content search via ripgrep (POLISH-021 / MIN-103, MIN-196).
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { rgPath } from '@vscode/ripgrep';
import { truncateUtf8 } from '../../src/lib/fetch-web-content.mjs';
import {
  DEFAULT_MAX_LINE_CHARS,
  DEFAULT_MAX_OUTPUT_CHARS,
  GREP_MAX_LINE_CHARS,
  GREP_MAX_OUTPUT_CHARS,
  capLineLength,
} from './output-cap.js';

const execFileAsync = promisify(execFile);

/** Default max lines returned per request. */
export const GREP_DEFAULT_HEAD_LIMIT = 50;

/** Hard cap for head_limit argument. */
export const GREP_MAX_HEAD_LIMIT = 200;

export { GREP_MAX_OUTPUT_CHARS, GREP_MAX_LINE_CHARS };

/** Skip files larger than this when ripgrep scans (bytes). */
const GREP_MAX_FILE_BYTES = '2M';

const VALID_OUTPUT_MODES = new Set(['content', 'count', 'files_with_matches', 'grouped']);

/**
 * Clamp a numeric tool argument into [min, max].
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Escape regex metacharacters when searching with a literal pattern.
 * @param {string} text
 */
function escapeRegexLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when a ripgrep output line is a primary match (not context or separator).
 * @param {string} line
 */
export function isRipgrepMatchLine(line) {
  if (!line || line === '--') return false;
  // Directory search: path/to/file.ts:42:content or path/to/file.ts-41-context
  if (/^[^:\n]+:\d+:/.test(line)) return true;
  // Single-file search: 42:content
  return /^\d+:/.test(line);
}

/**
 * Apply offset pagination, line count, per-line length, and total char caps.
 * @param {string} stdout
 * @param {{
 *   offset?: number,
 *   headLimit?: number,
 *   maxLineChars?: number,
 *   maxOutputChars?: number,
 * }} [options]
 * @returns {{ text: string, truncated: boolean, lineCount: number, nextOffset: number }}
 */
export function capGrepOutput(stdout, options = {}) {
  const offset = Math.max(0, options.offset ?? 0);
  const headLimit = options.headLimit ?? GREP_DEFAULT_HEAD_LIMIT;
  const maxLineChars = options.maxLineChars ?? GREP_MAX_LINE_CHARS;
  const maxOutputChars = options.maxOutputChars ?? GREP_MAX_OUTPUT_CHARS;

  const lines = stdout.split(/\r?\n/);
  const kept = [];
  let skipped = 0;
  let totalChars = 0;
  let truncated = false;

  for (const rawLine of lines) {
    if (rawLine === '') continue;

    if (skipped < offset) {
      skipped += 1;
      continue;
    }

    if (kept.length >= headLimit) {
      truncated = true;
      break;
    }

    const line = capLineLength(rawLine, maxLineChars);
    const addedChars = line.length + (kept.length > 0 ? 1 : 0);
    if (totalChars + addedChars > maxOutputChars) {
      truncated = true;
      break;
    }

    kept.push(line);
    totalChars += addedChars;
  }

  let text = kept.join('\n');
  const lineCount = kept.length;
  const nextOffset = offset + lineCount;

  if (truncated) {
    const hint =
      lineCount > 0
        ? `use offset=${nextOffset} for the next page or raise head_limit (max ${GREP_MAX_HEAD_LIMIT})`
        : `use offset=${offset} with a smaller head_limit`;
    text = `${text}\n(truncated at ${lineCount} match lines, default head_limit=${GREP_DEFAULT_HEAD_LIMIT}; ${hint})`;
  }

  const beforeUtf8 = text;
  text = truncateUtf8(text, maxOutputChars);
  if (text !== beforeUtf8) {
    truncated = true;
  }

  return { text, truncated, lineCount, nextOffset };
}

/**
 * @deprecated Use capGrepOutput — kept for existing imports/tests.
 * @param {string} stdout
 * @param {number} maxMatchLines
 */
export function truncateRipgrepOutput(stdout, maxMatchLines) {
  return capGrepOutput(stdout, { headLimit: maxMatchLines });
}

/**
 * Reformat path:line:snippet rows into per-file blocks for easier scanning.
 * @param {string} cappedText Output from capGrepOutput (may include truncation footer).
 */
export function formatGroupedGrepOutput(cappedText) {
  const rawLines = cappedText.split('\n');
  const truncationFooter = rawLines.find((line) => line.startsWith('(truncated'));
  const lines = rawLines.filter((line) => line && !line.startsWith('(truncated'));

  /** @type {Map<string, Array<{ lineNum: string; snippet: string }>>} */
  const groups = new Map();
  let currentFile = '';

  for (const line of lines) {
    const withPath = line.match(/^(.+?):(\d+):(.*)$/);
    if (withPath) {
      const [, filePath, lineNum, snippet] = withPath;
      if (!groups.has(filePath)) groups.set(filePath, []);
      groups.get(filePath).push({ lineNum, snippet });
      currentFile = filePath;
      continue;
    }
    const lineOnly = line.match(/^(\d+):(.*)$/);
    if (lineOnly && currentFile) {
      const [, lineNum, snippet] = lineOnly;
      groups.get(currentFile).push({ lineNum, snippet });
    }
  }

  const blocks = [];
  for (const [filePath, matches] of groups) {
    blocks.push(filePath);
    for (const { lineNum, snippet } of matches) {
      blocks.push(`  ${lineNum}: ${snippet}`);
    }
    blocks.push('');
  }

  let text = blocks.join('\n').replace(/\n+$/, '');
  if (truncationFooter) {
    text = `${text}\n${truncationFooter}`;
  }
  return text;
}

/**
 * Build ripgrep CLI args for the requested output mode.
 * @param {{
 *   outputMode: string,
 *   literal: boolean,
 *   caseInsensitive: boolean,
 *   context: number,
 *   glob: string,
 *   maxCount: number,
 * }} opts
 */
function buildRipgrepArgs(opts) {
  const rgArgs = ['--max-filesize', GREP_MAX_FILE_BYTES];

  if (opts.outputMode === 'content') {
    rgArgs.push('-n', '--no-heading');
    if (opts.context > 0) {
      rgArgs.push('-C', String(opts.context));
    }
  } else if (opts.outputMode === 'count') {
    rgArgs.push('--count');
  } else if (opts.outputMode === 'files_with_matches') {
    rgArgs.push('--files-with-matches');
  }

  if (opts.maxCount > 0) {
    rgArgs.push('--max-count', String(opts.maxCount));
  }

  if (opts.literal) {
    rgArgs.push('-F');
  }
  if (opts.caseInsensitive) {
    rgArgs.push('-i');
  }
  if (opts.glob) {
    rgArgs.push('-g', opts.glob);
  }

  return rgArgs;
}

/**
 * Run workspace grep via bundled ripgrep.
 * @param {Record<string, unknown>} args
 * @param {{
 *   resolveSafePath: (p: string, opts?: { write?: boolean }) => string,
 *   toRelativePath: (abs: string) => string,
 *   getWorkspaceRoot: () => string,
 * }} deps
 */
export async function runGrepSearch(args, deps) {
  const pattern = args?.pattern;
  if (!pattern || typeof pattern !== 'string') {
    return 'Error: pattern is required';
  }

  const literal = args?.literal === true;
  if (!literal) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: invalid regex: ${message}`;
    }
  }

  const headLimit = clampInt(
    args?.head_limit,
    1,
    GREP_MAX_HEAD_LIMIT,
    GREP_DEFAULT_HEAD_LIMIT,
  );
  const offset = clampInt(args?.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const context = clampInt(args?.context, 0, 5, 0);
  const caseInsensitive = args?.case_insensitive === true;
  const glob =
    typeof args?.glob === 'string' && args.glob.trim() ? args.glob.trim() : '';
  const outputModeRaw =
    typeof args?.output_mode === 'string' ? args.output_mode.trim() : 'content';
  const outputMode = VALID_OUTPUT_MODES.has(outputModeRaw)
    ? outputModeRaw
    : 'content';

  const resolved = deps.resolveSafePath(
    typeof args?.path === 'string' && args.path.trim() ? args.path.trim() : '.',
  );
  const workspaceRoot = deps.getWorkspaceRoot();
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return `Error: path not found: ${deps.toRelativePath(resolved)}`;
  }

  const displayRoot = deps.toRelativePath(stat.isDirectory() ? resolved : path.dirname(resolved));
  const searchTarget = resolved;
  const rgPattern = literal ? escapeRegexLiteral(pattern) : pattern;

  const ripgrepMode = outputMode === 'grouped' ? 'content' : outputMode;
  const rgArgs = buildRipgrepArgs({
    outputMode: ripgrepMode,
    literal,
    caseInsensitive,
    context: ripgrepMode === 'content' ? context : 0,
    glob,
    maxCount: headLimit + offset,
  });
  rgArgs.push(rgPattern, searchTarget);

  let stdout = '';
  try {
    const result = await execFileAsync(rgPath, rgArgs, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout ?? '';
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    const partial = err && typeof err === 'object' && 'stdout' in err ? String(err.stdout) : '';
    if (code === 1) {
      return `No matches for "${pattern}" under ${displayRoot}`;
    }
    if (code === 2 && partial.trim()) {
      stdout = partial;
    } else {
      const message = err instanceof Error ? err.message : String(err);
      return `Error running grep: ${message}`;
    }
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return `No matches for "${pattern}" under ${displayRoot}`;
  }

  let { text } = capGrepOutput(trimmed, {
    offset,
    headLimit,
    maxLineChars: GREP_MAX_LINE_CHARS,
    maxOutputChars: GREP_MAX_OUTPUT_CHARS,
  });

  if (outputMode === 'grouped') {
    text = formatGroupedGrepOutput(text);
  }

  return text;
}
