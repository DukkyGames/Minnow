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
 * Commands accepted by run_impeccable (harness returns guidance; detect/live spawn).
 * @returns {string[]}
 */
export function listAcceptedRunImpeccableCommands() {
  const names = new Set([...CLI_COMMANDS, ...SCRIPT_COMMANDS.keys(), ...HARNESS_COMMANDS]);
  return [...names].sort();
}

/**
 * Deterministic guidance when run_impeccable is called with a harness command.
 * @param {string} command
 * @returns {string}
 */
export function harnessCommandGuidance(command) {
  const cmd = String(command ?? '').trim().toLowerCase();
  return `Impeccable harness command: ${cmd}

"${cmd}" is not available as an \`npx impeccable\` subcommand. Use \`/impeccable ${cmd}\` so Minnow injects \`reference/${cmd}.md\` into the skill body, then follow that workflow with \`load_impeccable_context\` and file tools. Do not run \`npx impeccable ${cmd}\`.`;
}
