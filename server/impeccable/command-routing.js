/**
 * Classify Impeccable sub-commands: harness (reference-driven) vs CLI vs bundled scripts.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Harness commands from pin.mjs VALID_COMMANDS — reference/*.md workflows. */
export const HARNESS_COMMANDS = new Set([
  'craft',
  'teach',
  'extract',
  'document',
  'shape',
  'critique',
  'audit',
  'polish',
  'bolder',
  'quieter',
  'distill',
  'harden',
  'onboard',
  'live',
  'animate',
  'colorize',
  'typeset',
  'layout',
  'delight',
  'overdrive',
  'clarify',
  'adapt',
  'optimize',
]);

/** Top-level npx impeccable sub-commands supported by the upstream CLI. */
export const CLI_COMMANDS = new Set(['detect']);

/** Bundled script entrypoints under src/skills/impeccable/ (relative paths). */
export const SCRIPT_COMMANDS = new Map([['live', 'scripts/live.mjs']]);

/**
 * Parse slash remainder after `/impeccable` (first token = command, rest = target).
 * @param {string} userText
 * @returns {{ command: string | null, target: string }}
 */
export function parseImpeccableSubcommand(userText) {
  let trimmed = typeof userText === 'string' ? userText.trim() : '';
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('/impeccable')) {
    trimmed = trimmed.slice('/impeccable'.length).trim();
  } else if (lower.startsWith('impeccable ')) {
    trimmed = trimmed.slice('impeccable'.length).trim();
  }
  if (!trimmed) {
    return { command: null, target: '' };
  }
  const space = trimmed.indexOf(' ');
  if (space === -1) {
    return { command: trimmed, target: '' };
  }
  return {
    command: trimmed.slice(0, space),
    target: trimmed.slice(space + 1).trim(),
  };
}

/**
 * @param {string} appRoot Minnow install root
 * @param {string} command
 * @returns {string | null} Absolute path to reference markdown when the file exists
 */
export function resolveReferencePath(appRoot, command) {
  const cmd = typeof command === 'string' ? command.trim().toLowerCase() : '';
  if (!cmd) return null;
  const refPath = path.join(
    appRoot,
    'src',
    'skills',
    'impeccable',
    'reference',
    `${cmd}.md`,
  );
  return fs.existsSync(refPath) ? refPath : null;
}

/**
 * @param {string} cmd
 * @returns {boolean}
 */
export function isHarnessCommand(cmd) {
  return HARNESS_COMMANDS.has(String(cmd ?? '').trim().toLowerCase());
}

/**
 * @param {string} cmd
 * @returns {boolean}
 */
export function isCliCommand(cmd) {
  return CLI_COMMANDS.has(String(cmd ?? '').trim().toLowerCase());
}

/**
 * @param {string} cmd
 * @returns {boolean}
 */
export function isScriptCommand(cmd) {
  return SCRIPT_COMMANDS.has(String(cmd ?? '').trim().toLowerCase());
}

/**
 * Commands accepted by run_impeccable (CLI detect + bundled live script only).
 * @returns {string[]}
 */
export function listAcceptedRunImpeccableCommands() {
  const names = new Set([...CLI_COMMANDS, ...SCRIPT_COMMANDS.keys()]);
  return [...names].sort();
}

/**
 * Deterministic guidance when run_impeccable is called with a harness command.
 * @param {string} command
 * @returns {string}
 */
export function harnessCommandGuidance(command) {
  const cmd = String(command ?? '').trim().toLowerCase();
  const spawnable = listAcceptedRunImpeccableCommands().join(', ');
  return `Impeccable harness command: ${cmd}

"${cmd}" is not a \`run_impeccable\` subcommand (valid: ${spawnable}). Harness workflows are injected when you use \`/impeccable ${cmd}\` in the composer, or may already appear in the system prompt. Follow that workflow with \`load_impeccable_context\` and file tools. Do not run \`npx impeccable ${cmd}\`.`;
}

/**
 * Guidance + reference markdown when a harness command is mistakenly passed to run_impeccable.
 * @param {string} appRoot Minnow install root
 * @param {string} command Harness sub-command
 * @returns {string}
 */
export function harnessCommandGuidanceWithReference(appRoot, command) {
  const cmd = String(command ?? '').trim().toLowerCase();
  let result = harnessCommandGuidance(cmd);
  if (!isHarnessCommand(cmd)) {
    return result;
  }

  const refPath = resolveReferencePath(appRoot, cmd);
  if (!refPath) {
    return result;
  }

  const MAX_REFERENCE_CHARS = 64_000;
  const TRUNCATION_MARKER = '\n\n…[reference truncated at 64k]';
  let content = fs.readFileSync(refPath, 'utf8');
  if (content.length > MAX_REFERENCE_CHARS) {
    content = content.slice(0, MAX_REFERENCE_CHARS) + TRUNCATION_MARKER;
  }

  return `${result}

---
## reference/${cmd}.md (follow this workflow in chat)
${content}`;
}
