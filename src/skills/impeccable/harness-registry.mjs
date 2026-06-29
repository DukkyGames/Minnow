/**
 * Single source of truth for Impeccable harness commands (reference-driven workflows).
 * VALID_COMMANDS is parsed from vendored scripts/pin.mjs after each sync.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PIN_PATH = path.join(__dirname, 'scripts', 'pin.mjs');

/** Legacy slash alias → canonical harness command (init replaced teach in v3). */
export const HARNESS_ALIASES = Object.freeze({
  teach: 'init',
});

/**
 * Parse VALID_COMMANDS from pin.mjs without executing its CLI entrypoint.
 * @param {string} [pinPath]
 * @returns {string[]}
 */
export function parseValidCommandsFromPin(pinPath = DEFAULT_PIN_PATH) {
  const source = fs.readFileSync(pinPath, 'utf8');
  const match = source.match(/const\s+VALID_COMMANDS\s*=\s*\[([\s\S]*?)\];/);
  if (!match) {
    throw new Error(`Could not parse VALID_COMMANDS from ${pinPath}`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Harness commands from upstream pin.mjs (reference/*.md workflows). */
export const HARNESS_COMMANDS = new Set(parseValidCommandsFromPin());

/**
 * Resolve a user-facing sub-command to its canonical harness name.
 * @param {string} cmd
 * @returns {string | null}
 */
export function resolveHarnessCommand(cmd) {
  const normalized = String(cmd ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (Object.hasOwn(HARNESS_ALIASES, normalized)) {
    return HARNESS_ALIASES[normalized];
  }
  if (HARNESS_COMMANDS.has(normalized)) {
    return normalized;
  }
  return null;
}

/**
 * Canonical harness command names (sorted).
 * @returns {string[]}
 */
export function listHarnessCommandNames() {
  return [...HARNESS_COMMANDS].sort();
}

/**
 * @param {string} cmd
 * @returns {boolean}
 */
export function isHarnessCommandName(cmd) {
  return resolveHarnessCommand(cmd) !== null;
}
