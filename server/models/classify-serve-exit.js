/**
 * llama-server exit classification used by the crash watcher restart policy.
 *
 * Phase 3: real exits go through `diagnoseLlamaFailure`. Tests still inject
 * `oom_vram` / `port_conflict` / `transient` via the override so restart-policy
 * suites do not depend on log fixtures.
 */

import { diagnoseLlamaFailure } from './diagnose-llama-failure.js';

/**
 * @typedef {object} ServeExitClassification
 * @property {string} code
 * @property {string} [title]
 * @property {string} [detail]
 * @property {string} [remediation]
 * @property {boolean} [retryable]
 * @property {Record<string, unknown>} [suggestedSettings]
 */

/**
 * @typedef {object} ClassifyServeExitInput
 * @property {number | null} [exitCode]
 * @property {string} [logTail]
 * @property {object | null} [plan]
 */

/** @type {((input: ClassifyServeExitInput) => ServeExitClassification) | null} */
let classifyOverrideForTests = null;

export function setClassifyServeExitOverrideForTests(fn) {
  classifyOverrideForTests = fn;
}

export function resetClassifyServeExitOverrideForTests() {
  classifyOverrideForTests = null;
}

/**
 * @param {ClassifyServeExitInput} [input]
 * @returns {ServeExitClassification}
 */
export function classifyServeExit(input = {}) {
  if (classifyOverrideForTests) {
    return classifyOverrideForTests(input);
  }
  // Wrapper keeps shouldAutoRestartServe on `.code` while the UI reads title/remediation.
  return diagnoseLlamaFailure(input.logTail ?? '', input.exitCode ?? null, input.plan ?? null);
}
