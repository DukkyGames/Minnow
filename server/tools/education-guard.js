/**
 * Server-side Education Mode guard (mirrors src/chat/modes/education-guard.ts).
 *
 * Server-side enforcement is what makes the overlay hold for the Session Engine
 * and any other path that posts straight to /api/tools without going through the
 * browser tool client. test/education/education-guard.test.mjs asserts the two
 * copies agree on the denied set and on the same shell corpus.
 */

import { isEducationModeEnabled } from '../config/education.js';

/** Mirror of EDUCATION_DENIED_TOOL_IDS in src/chat/modes/education-overlay.ts. */
export const EDUCATION_DENIED_TOOL_IDS = new Set([
  // files-write group
  'save_file',
  'append_file',
  'insert_at_line',
  'replace_text_in_file',
  'make_directory',
  'move_file',
  'copy_file',
  'delete_path',
  'create_pdf',
  'create_spreadsheet',
  'create_word_document',
  // agent must not switch Education Mode off from a chat
  'update_settings',
  // "code execution" in name only: one writeFileSync from being a file editor
  'run_javascript',
  'run_python',
]);

const EXTERNAL_WRITE_NAME_RE = /write|edit|create|save|delete|remove|patch|append|mkdir|rename|move/i;

const SHELL_TOOL_NAMES = new Set(['execute_command', 'start_background_command']);

const WRITE_TOOL_MESSAGE =
  'Error: Education Mode is on, so I cannot edit files for you. Tell me what you think the change should be and I will review it, or ask me to run the tests and read the failure with you.';

const SHELL_WRITE_MESSAGE =
  'Error: Education Mode is on, so I cannot use the shell to change files. I can still run your tests, reproduce the failure, and read the repo with you.';

const SETTINGS_MESSAGE =
  'Error: Education Mode is on, so update_settings is unavailable. Open Settings and General to change it yourself.';

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

const WRITE_COMMANDS = new Set([
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
  'sc',
  'ac',
  'ni',
  'ri',
  'cpi',
  'mi',
  'rni',
  'rnp',
]);

/** @type {Record<string, readonly string[]>} */
const INLINE_EVAL_FLAGS = {
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

const GIT_WRITE_SUBCOMMANDS = new Set(['apply', 'am', 'restore', 'rm', 'mv', 'clean']);

const SEGMENT_SPLIT_RE = /(?:&&|\|\||[;|&\n\r])+/;

/** @param {string} command */
function stripQuotedSpans(command) {
  return command
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/`[^`]*`/g, ' ');
}

/** @param {string} token */
function normalizeCommandName(token) {
  const base = token.replace(/\\/g, '/').split('/').pop() ?? token;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/**
 * @param {string} segment
 * @returns {string[]}
 */
function commandTokens(segment) {
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
 * Strip fd plumbing (`2>&1`, `>&2`, `2>/dev/null`) before segment splitting:
 * `&` doubles as a separator, so splitting first would leave a bare `>`.
 * @param {string} command
 */
function scrubRedirectNoise(command) {
  return command
    .replace(/\d*>>?\s*(?:\/dev\/null|NUL|\$null)\b/gi, ' ')
    .replace(/\d*>&\s*[\d-]/g, ' ');
}

/** @param {string[]} tokens */
function isInlineEvalInvocation(tokens) {
  const flags = INLINE_EVAL_FLAGS[normalizeCommandName(tokens[0])];
  if (!flags) return false;
  return tokens.slice(1).some((token) => flags.includes(token.toLowerCase()));
}

/** @param {string[]} tokens */
function isInPlaceStreamEdit(tokens) {
  const name = normalizeCommandName(tokens[0]);
  const args = tokens.slice(1);
  if (name === 'sed') {
    return args.some((t) => t === '--in-place' || /^--in-place=/.test(t) || /^-[a-z]*i/.test(t));
  }
  if (name === 'perl') {
    return args.some((t) => /^-[a-zA-Z]*i/.test(t) || /^--in-place/.test(t));
  }
  if (name === 'awk' || name === 'gawk') {
    return args.some((t) => /^-i\b/.test(t) || t === '--in-place');
  }
  return false;
}

/** @param {string[]} tokens */
function isDestructiveGit(tokens) {
  if (normalizeCommandName(tokens[0]) !== 'git') return false;
  const args = tokens.slice(1).filter((t) => !t.startsWith('-'));
  const sub = args[0]?.toLowerCase();
  if (!sub) return false;
  if (GIT_WRITE_SUBCOMMANDS.has(sub)) return true;
  if (sub === 'checkout') return tokens.includes('--');
  if (sub === 'reset') return tokens.some((t) => t.toLowerCase() === '--hard');
  return false;
}

/** @param {string[]} tokens */
function isDestructiveFind(tokens) {
  if (normalizeCommandName(tokens[0]) !== 'find') return false;
  return tokens
    .slice(1)
    .some((t) => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(t.toLowerCase()));
}

/**
 * Best-effort shell denylist. Returns an error message or null.
 * @param {unknown} command
 * @returns {string | null}
 */
export function blockEducationShellWrite(command) {
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

/**
 * @param {boolean} enabled
 * @param {string} toolName
 * @param {Record<string, unknown>} [args]
 * @returns {string | null}
 */
export function blockEducationModeWrite(enabled, toolName, args = {}, toolCaller) {
  if (!enabled) return null;
  if (toolCaller === 'user') return null;

  if (toolName === 'update_settings') return SETTINGS_MESSAGE;
  if (EDUCATION_DENIED_TOOL_IDS.has(toolName)) return WRITE_TOOL_MESSAGE;
  if (
    (toolName.startsWith('mcp__') || toolName.startsWith('plugin__')) &&
    EXTERNAL_WRITE_NAME_RE.test(toolName)
  ) {
    return WRITE_TOOL_MESSAGE;
  }

  if (SHELL_TOOL_NAMES.has(toolName)) {
    return blockEducationShellWrite(args?.command);
  }

  return null;
}

/**
 * Dispatch-site entry point: reads the live flag from config.json.
 * @param {string} toolName
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string | null>}
 */
export async function blockEducationToolCall(toolName, args = {}, toolCaller) {
  return blockEducationModeWrite(await isEducationModeEnabled(), toolName, args, toolCaller);
}
