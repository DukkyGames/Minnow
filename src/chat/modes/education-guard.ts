/**
 * Education Mode dispatch guard — the *execution* layer.
 *
 * The overlay in education-overlay.ts strips write tools from what the model
 * sees. This rejects them at dispatch, which is what catches sub-agents, board
 * members, replayed tool calls, and any path that skips exposure filtering.
 *
 * The shell denylist below is explicitly best-effort, not a sandbox. Education
 * Mode keeps `execute_command` because running the student's tests is the single
 * most valuable teaching tool, and that necessarily leaves heredocs, interpreter
 * scripts, and unrecognised tooling as write paths. The bar here is "the agent
 * will not write code for you, and will not be talked into it", not "an adversary
 * cannot escape" — the student can turn the toggle off anyway.
 */

import { isEducationModeEnabledSync } from '../../config/education-meta';
import {
  EDUCATION_DENIED_TOOL_IDS,
  isExternalWriteToolName,
} from './education-overlay';

/** Tools whose `command` argument goes through the shell denylist. */
const SHELL_TOOL_NAMES = new Set(['execute_command', 'start_background_command']);

const WRITE_TOOL_MESSAGE =
  'Error: Education Mode is on, so I cannot edit files for you. Tell me what you think the change should be and I will review it, or ask me to run the tests and read the failure with you.';

const SHELL_WRITE_MESSAGE =
  'Error: Education Mode is on, so I cannot use the shell to change files. I can still run your tests, reproduce the failure, and read the repo with you.';

const SETTINGS_MESSAGE =
  'Error: Education Mode is on, so update_settings is unavailable. Open Settings and General to change it yourself.';

/* ------------------------------------------------------------------ *
 * Shell denylist
 * ------------------------------------------------------------------ */

/** Wrappers that delegate to the real command in the next token. */
const COMMAND_WRAPPERS = new Set([
  'sudo',
  'doas',
  'env',
  'nohup',
  'time',
  'command',
  'builtin',
  'exec',
  'nice',
  'ionice',
  'stdbuf',
  'xargs',
  'watch',
  'timeout',
]);

/**
 * Commands that exist to change the filesystem. POSIX, Windows `cmd`, and
 * PowerShell forms are all listed: Minnow's primary shell on Windows is
 * PowerShell, so a POSIX-only list would leave the biggest hole open.
 */
const WRITE_COMMANDS = new Set([
  // POSIX
  'tee',
  'patch',
  'cp',
  'mv',
  'rm',
  'rmdir',
  'mkdir',
  'touch',
  'dd',
  'truncate',
  'shred',
  'install',
  'ln',
  'unlink',
  'rsync',
  'ditto',
  // Windows cmd
  'copy',
  'xcopy',
  'robocopy',
  'move',
  'del',
  'erase',
  'md',
  'rd',
  'ren',
  'rename',
  'fsutil',
  // PowerShell cmdlets
  'set-content',
  'add-content',
  'clear-content',
  'out-file',
  'new-item',
  'remove-item',
  'copy-item',
  'move-item',
  'rename-item',
  'set-itemproperty',
  'export-csv',
  'export-clixml',
  'new-itemproperty',
  'set-itemproperty',
  // Short aliases PowerShell resolves to the cmdlets above
  'sc',
  'ac',
  'ni',
  'ri',
  'cpi',
  'mi',
  'rni',
  'rnp',
]);

/** Interpreters plus the flags that make them run inline source. */
const INLINE_EVAL_FLAGS: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  nodejs: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval'],
  python: ['-c'],
  python2: ['-c'],
  python3: ['-c'],
  py: ['-c'],
  ruby: ['-e'],
  php: ['-r'],
};

/** git subcommands that rewrite or discard the student's working tree. */
const GIT_WRITE_SUBCOMMANDS = new Set(['apply', 'am', 'restore', 'rm', 'mv', 'clean']);

/** Segment separators: `;` `&&` `||` `|` `&` and newlines. */
const SEGMENT_SPLIT_RE = /(?:&&|\|\||[;|&\n\r])+/;

/** Replace quoted spans with a space so their contents cannot fake a redirect. */
function stripQuotedSpans(command: string): string {
  return command
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/`[^`]*`/g, ' ');
}

/** Bare command name: drop any directory prefix and a Windows executable suffix. */
function normalizeCommandName(token: string): string {
  const base = token.replace(/\\/g, '/').split('/').pop() ?? token;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/** Tokens of one segment with leading `VAR=value` assignments and wrappers removed. */
function commandTokens(segment: string): string[] {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < tokens.length) {
    const token = tokens[start];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      start += 1;
      continue;
    }
    if (COMMAND_WRAPPERS.has(normalizeCommandName(token))) {
      start += 1;
      continue;
    }
    break;
  }
  return tokens.slice(start);
}

/**
 * Remove file-descriptor plumbing that read-only pipelines depend on:
 * `2>&1`, `>&2`, `2>/dev/null`, `2>$null`.
 *
 * This runs *before* segment splitting, not after. `&` is also a segment
 * separator, so splitting first would tear `2>&1` into `… 2>` and `1`, leaving a
 * bare `>` that reads as a file redirect. That would reject
 * `npm test 2>&1 | tail -20` and cost the tutor its most useful command.
 */
function scrubRedirectNoise(command: string): string {
  return command
    .replace(/\d*>>?\s*(?:\/dev\/null|NUL|\$null)\b/gi, ' ')
    .replace(/\d*>&\s*[\d-]/g, ' ');
}

/** `find … -delete` / `-exec rm {} \;` never reaches a segment split. */
function isDestructiveFind(tokens: string[]): boolean {
  if (normalizeCommandName(tokens[0]) !== 'find') return false;
  return tokens
    .slice(1)
    .some((t) => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(t.toLowerCase()));
}

function isInlineEvalInvocation(tokens: string[]): boolean {
  const name = normalizeCommandName(tokens[0]);
  const flags = INLINE_EVAL_FLAGS[name];
  if (!flags) return false;
  return tokens.slice(1).some((token) => flags.includes(token.toLowerCase()));
}

function isInPlaceStreamEdit(tokens: string[]): boolean {
  const name = normalizeCommandName(tokens[0]);
  const args = tokens.slice(1);
  if (name === 'sed') {
    return args.some((t) => t === '--in-place' || /^--in-place=/.test(t) || /^-[a-z]*i/.test(t));
  }
  if (name === 'perl') {
    // `perl -pi -e` / `perl -i.bak -pe`; the plain `perl -e` case is caught by
    // the inline-eval rule instead.
    return args.some((t) => /^-[a-zA-Z]*i/.test(t) || /^--in-place/.test(t));
  }
  if (name === 'awk' || name === 'gawk') {
    return args.some((t) => /^-i\b/.test(t) || t === '--in-place');
  }
  return false;
}

function isDestructiveGit(tokens: string[]): boolean {
  if (normalizeCommandName(tokens[0]) !== 'git') return false;
  const args = tokens.slice(1).filter((t) => !t.startsWith('-'));
  const sub = args[0]?.toLowerCase();
  if (!sub) return false;
  if (GIT_WRITE_SUBCOMMANDS.has(sub)) return true;
  // `git checkout -- src/foo.ts` and `git reset --hard` throw away the student's work.
  if (sub === 'checkout') return tokens.includes('--');
  if (sub === 'reset') return tokens.some((t) => t.toLowerCase() === '--hard');
  return false;
}

/**
 * Best-effort denylist over `execute_command` / `start_background_command`.
 * Returns an error message when the command would modify files, else null.
 */
export function blockEducationShellWrite(command: unknown): string | null {
  if (typeof command !== 'string' || !command.trim()) return null;

  const scrubbed = scrubRedirectNoise(stripQuotedSpans(command));
  for (const segment of scrubbed.split(SEGMENT_SPLIT_RE)) {
    if (!segment.trim()) continue;
    if (segment.includes('>')) return SHELL_WRITE_MESSAGE;

    const tokens = commandTokens(segment);
    if (tokens.length === 0) continue;

    if (WRITE_COMMANDS.has(normalizeCommandName(tokens[0]))) return SHELL_WRITE_MESSAGE;
    if (isInlineEvalInvocation(tokens)) return SHELL_WRITE_MESSAGE;
    if (isInPlaceStreamEdit(tokens)) return SHELL_WRITE_MESSAGE;
    if (isDestructiveGit(tokens)) return SHELL_WRITE_MESSAGE;
    if (isDestructiveFind(tokens)) return SHELL_WRITE_MESSAGE;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Tool dispatch guard
 * ------------------------------------------------------------------ */

/**
 * Returns an error message when Education Mode blocks this call, or null.
 * `enabled` is a parameter so the rule stays pure and directly testable.
 */
export function blockEducationModeWrite(
  enabled: boolean,
  toolName: string,
  args: Record<string, unknown> = {},
  toolCaller?: 'user' | 'agent',
): string | null {
  if (!enabled) return null;
  // Students edit their own files in the Code viewer and tree; only agent dispatch is blocked.
  if (toolCaller === 'user') return null;

  if (toolName === 'update_settings') return SETTINGS_MESSAGE;
  if (EDUCATION_DENIED_TOOL_IDS.has(toolName)) return WRITE_TOOL_MESSAGE;
  if (isExternalWriteToolName(toolName)) return WRITE_TOOL_MESSAGE;

  if (SHELL_TOOL_NAMES.has(toolName)) {
    return blockEducationShellWrite(args?.command);
  }

  return null;
}

/** Dispatch-site entry point: reads the live flag, then applies the rule. */
export function blockEducationToolCall(
  toolName: string,
  args: Record<string, unknown> = {},
  toolCaller?: 'user' | 'agent',
): string | null {
  return blockEducationModeWrite(
    isEducationModeEnabledSync(),
    toolName,
    args,
    toolCaller,
  );
}
