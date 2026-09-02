import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getRipgrepPath } from '../lib/ripgrep-path.js';
import { truncateUtf8 } from '../../src/lib/fetch-web-content.mjs';
import {
  GREP_MAX_LINE_CHARS,
  GREP_MAX_OUTPUT_CHARS,
  capLineLength,
  getOutputCapPolicy,
  withFullResultFooterHint,
} from './output-cap.js';

const execFileAsync = promisify(execFile);

const rgExecutable = getRipgrepPath();

export const GREP_DEFAULT_HEAD_LIMIT = 500;

export const GREP_MAX_HEAD_LIMIT = 2_000;

export const FIND_FILES_DEFAULT_MAX = 2_000;

export { GREP_MAX_OUTPUT_CHARS, GREP_MAX_LINE_CHARS };

const GREP_MAX_FILE_BYTES = '2M';

const VALID_OUTPUT_MODES = new Set(['content', 'count', 'files_with_matches', 'grouped']);

/**
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
 * @param {string} text
 */
function escapeRegexLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} line
 */
export function isRipgrepMatchLine(line) {
  if (!line || line === '--') return false;
  if (/^[^:\n]+:\d+:/.test(line)) return true;
  return /^\d+:/.test(line);
}

/**
 * @param {string} stdout
 * @param {{ offset?: number, headLimit?: number, maxLineChars?: number, maxOutputChars?: number, }} [options]
 * @returns {{ text: string, truncated: boolean, lineCount: number, nextOffset: number }}
 */
export function capGrepOutput(stdout, options = {}) {
  const policy = getOutputCapPolicy();
  const applyResultCap = options.applyResultCap ?? policy.applyResultCap;
  const offset = Math.max(0, options.offset ?? 0);
  const explicitHead = options.explicitHeadLimit === true;
  const headLimit =
    explicitHead || applyResultCap
      ? (options.headLimit ?? GREP_DEFAULT_HEAD_LIMIT)
      : Number.MAX_SAFE_INTEGER;
  const maxLineChars = applyResultCap
    ? (options.maxLineChars ?? GREP_MAX_LINE_CHARS)
    : Number.MAX_SAFE_INTEGER;
  const maxOutputChars = applyResultCap
    ? (options.maxOutputChars ?? GREP_MAX_OUTPUT_CHARS)
    : Number.MAX_SAFE_INTEGER;

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

    const line = applyResultCap ? capLineLength(rawLine, maxLineChars) : rawLine;
    const addedChars = line.length + (kept.length > 0 ? 1 : 0);
    if (applyResultCap && totalChars + addedChars > maxOutputChars) {
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
    const canRaiseLimit = applyResultCap && GREP_DEFAULT_HEAD_LIMIT < GREP_MAX_HEAD_LIMIT;
    const pageHint =
      lineCount > 0
        ? canRaiseLimit
          ? `use offset=${nextOffset} for the next page or raise head_limit (max ${GREP_MAX_HEAD_LIMIT})`
          : `use offset=${nextOffset} for the next page`
        : `use offset=${offset} with a smaller head_limit`;
    const hint = withFullResultFooterHint(pageHint, applyResultCap);
    text = `${text}\n(truncated at ${lineCount} match lines, default head_limit=${GREP_DEFAULT_HEAD_LIMIT}; ${hint})`;
  }

  if (applyResultCap) {
    const beforeUtf8 = text;
    text = truncateUtf8(text, maxOutputChars);
    if (text !== beforeUtf8) {
      truncated = true;
    }
  }

  return { text, truncated, lineCount, nextOffset };
}

/**
 * @deprecated
 * @param {string} stdout
 * @param {number} maxMatchLines
 */
export function truncateRipgrepOutput(stdout, maxMatchLines) {
  return capGrepOutput(stdout, { headLimit: maxMatchLines });
}

/**
 * @param {string} cappedText
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
 * @param {{ outputMode: string, literal: boolean, caseInsensitive: boolean, context: number, glob: string, maxCount: number, }} opts
 */
function buildRipgrepArgs(opts) {
  const rgArgs = [
    '--max-filesize',
    GREP_MAX_FILE_BYTES,
    '--path-separator',
    '/',
    '--sort',
    'path',
  ];

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
 * @param {Record<string, unknown>} args
 * @param {{ resolveSafePath: (p: string, opts?: { write?: boolean }) => string, toRelativePath: (abs: string) => string, getWorkspaceRoot: () => string, }} deps
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

  const policy = getOutputCapPolicy();
  const hasExplicitHead =
    args != null &&
    Object.prototype.hasOwnProperty.call(args, 'head_limit') &&
    args.head_limit != null;
  const headLimit = hasExplicitHead
    ? clampInt(
        args.head_limit,
        1,
        policy.applyResultCap ? GREP_MAX_HEAD_LIMIT : Number.MAX_SAFE_INTEGER,
        GREP_DEFAULT_HEAD_LIMIT,
      )
    : policy.applyResultCap
      ? GREP_DEFAULT_HEAD_LIMIT
      : Number.MAX_SAFE_INTEGER;
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

  const relTarget = path.relative(workspaceRoot, resolved);
  const searchTarget =
    relTarget === ''
      ? '.'
      : !relTarget.startsWith('..') && !path.isAbsolute(relTarget)
        ? relTarget
        : resolved;
  const rgPattern = literal ? escapeRegexLiteral(pattern) : pattern;

  const ripgrepMode = outputMode === 'grouped' ? 'content' : outputMode;
  const rgArgs = buildRipgrepArgs({
    outputMode: ripgrepMode,
    literal,
    caseInsensitive,
    context: ripgrepMode === 'content' ? context : 0,
    glob,
    maxCount:
      ripgrepMode === 'content' && headLimit < 1_000_000 ? headLimit + offset : 0,
  });
  rgArgs.push(rgPattern, searchTarget);

  let stdout = '';
  try {
    const result = await execFileAsync(rgExecutable, rgArgs, {
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

  const trimmed = stdout.replace(/^\.\//gm, '').trim();
  if (!trimmed) {
    return `No matches for "${pattern}" under ${displayRoot}`;
  }

  let { text } = capGrepOutput(trimmed, {
    offset,
    headLimit,
    applyResultCap: policy.applyResultCap,
    explicitHeadLimit: hasExplicitHead,
    maxLineChars: GREP_MAX_LINE_CHARS,
    maxOutputChars: GREP_MAX_OUTPUT_CHARS,
  });

  if (outputMode === 'grouped') {
    text = formatGroupedGrepOutput(text);
  }

  return text;
}

/**
 * @param {Record<string, unknown>} args
 * @param {{ resolveSafePath: (p: string, opts?: { write?: boolean }) => string, toRelativePath: (abs: string) => string, getWorkspaceRoot: () => string, }} deps
 * @param {{ maxResults?: number }} [options]
 */
export async function runFindFilesSearch(args, deps, options = {}) {
  const pattern = typeof args?.pattern === 'string' ? args.pattern.trim() : '';
  if (!pattern) {
    return 'Error: pattern is required';
  }
  const findPolicy = getOutputCapPolicy();
  const maxResults =
    options.maxResults ??
    (findPolicy.applyResultCap ? FIND_FILES_DEFAULT_MAX : Number.MAX_SAFE_INTEGER);

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
  const searchDir = stat.isDirectory() ? resolved : path.dirname(resolved);
  const displayRoot = deps.toRelativePath(searchDir);

  const relTarget = path.relative(workspaceRoot, searchDir);
  const target =
    relTarget === ''
      ? '.'
      : !relTarget.startsWith('..') && !path.isAbsolute(relTarget)
        ? relTarget
        : searchDir;

  const globNorm = pattern.replace(/\\/g, '/');
  const rgArgs = ['--files', '--path-separator', '/', '-g', globNorm];
  if (target !== '.') {
    rgArgs.push(target);
  }

  let stdout = '';
  try {
    const result = await execFileAsync(rgExecutable, rgArgs, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout ?? '';
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    const partial =
      err && typeof err === 'object' && 'stdout' in err ? String(err.stdout) : '';
    if (code === 1 && !partial.trim()) {
      return `No files matching "${pattern}" under ${displayRoot}`;
    }
    if ((code === 1 || code === 2) && partial.trim()) {
      stdout = partial;
    } else {
      const message = err instanceof Error ? err.message : String(err);
      return `Error running find: ${message}`;
    }
  }

  const files = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, '/'));

  if (files.length === 0) {
    return `No files matching "${pattern}" under ${displayRoot}`;
  }

  const limited = files.slice(0, maxResults);
  const suffix =
    files.length > maxResults ? `\n(truncated at ${maxResults} results)` : '';
  return `${limited.join('\n')}${suffix}`;
}
