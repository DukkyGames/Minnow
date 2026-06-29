/**
 * Server re-exports for Impeccable harness registry + legacy alias helpers.
 */

export {
  HARNESS_ALIASES as IMPECCABLE_COMMAND_ALIASES,
  HARNESS_COMMANDS,
  listHarnessCommandNames,
  resolveHarnessCommand,
} from '../../src/skills/impeccable/harness-registry.mjs';

import { resolveHarnessCommand } from '../../src/skills/impeccable/harness-registry.mjs';

/**
 * Resolve a slash sub-command to its canonical harness name (passthrough when unknown).
 * @param {string} command
 * @returns {string}
 */
export function resolveImpeccableCommandAlias(command) {
  const normalized = String(command ?? '').trim().toLowerCase();
  if (!normalized) return normalized;
  return resolveHarnessCommand(normalized) ?? normalized;
}

/**
 * @param {string} command
 * @returns {boolean}
 */
export function isImpeccableCommandAlias(command) {
  const normalized = String(command ?? '').trim().toLowerCase();
  return resolveHarnessCommand(normalized) !== null
    && resolveHarnessCommand(normalized) !== normalized;
}
