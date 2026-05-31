/**
 * Workspace-scoped content search via ripgrep (POLISH-021 / MIN-103).
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { rgPath } from '@vscode/ripgrep';

const execFileAsync = promisify(execFile);

/** Default max matching lines returned per request. */
export const GREP_DEFAULT_HEAD_LIMIT = 200;

/** Hard cap for head_limit argument. */
export const GREP_MAX_HEAD_LIMIT = 500;

/** Skip files larger than this when ripgrep scans (bytes). */
const GREP_MAX_FILE_BYTES = '2M';

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
 * Truncate ripgrep stdout to at most maxMatchLines primary matches.
 * @param {string} stdout
 * @param {number} maxMatchLines
 * @returns {{ text: string, truncated: boolean, matchCount: number }}
 */
export function truncateRipgrepOutput(stdout, maxMatchLines) {
  const lines = stdout.split(/\r?\n/);
  const kept = [];
  let matchCount = 0;
  let truncated = false;

  for (const line of lines) {
    if (line === '') {
      if (kept.length > 0 && kept[kept.length - 1] !== '') {
        kept.push('');
      }
      continue;
    }
    if (isRipgrepMatchLine(line)) {
      if (matchCount >= maxMatchLines) {
        truncated = true;
        break;
      }
      matchCount += 1;
    }
    if (!truncated) {
      kept.push(line);
    }
  }

  while (kept.length > 0 && kept[kept.length - 1] === '') {
    kept.pop();
  }

  return { text: kept.join('\n'), truncated, matchCount };
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
  const context = clampInt(args?.context, 0, 5, 0);
  const caseInsensitive = args?.case_insensitive === true;
  const glob =
    typeof args?.glob === 'string' && args.glob.trim() ? args.glob.trim() : '';

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

  const rgArgs = ['--max-filesize', GREP_MAX_FILE_BYTES, '-n', '--no-heading'];
  if (literal) {
    rgArgs.push('-F');
  }
  if (caseInsensitive) {
    rgArgs.push('-i');
  }
  if (context > 0) {
    rgArgs.push('-C', String(context));
  }
  if (glob) {
    rgArgs.push('-g', glob);
  }
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

  const { text, truncated, matchCount } = truncateRipgrepOutput(trimmed, headLimit);
  const suffix = truncated
    ? `\n(truncated at ${matchCount} matching lines)`
    : '';
  return `${text}${suffix}`;
}
