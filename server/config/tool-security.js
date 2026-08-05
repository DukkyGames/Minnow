/**
 * Tool path security flags from persisted config.json (`toolSecurity` block).
 */

import { readConfigJson } from './store.js';
import { normalizeShellSandboxMode } from '../terminal/sandbox/mode.js';

/**
 * @returns {Promise<'workspace'|'full'>}
 */
export async function getFilesystemAccessFromConfig() {
  try {
    const meta = await readConfigJson('config.json');
    if (meta && typeof meta === 'object') {
      const ts = /** @type {Record<string, unknown>} */ (meta).toolSecurity;
      if (ts && typeof ts === 'object') {
        const fa = /** @type {Record<string, unknown>} */ (ts).filesystemAccess;
        if (fa === 'full') return 'full';
      }
    }
  } catch {
    /* ignore */
  }
  return 'workspace';
}

/**
 * Agent shell sandbox setting (MIN-553 Phase 3). Default off.
 * @returns {Promise<'off'|'prefer'|'require'>}
 */
export async function getShellSandboxFromConfig() {
  try {
    const meta = await readConfigJson('config.json');
    if (meta && typeof meta === 'object') {
      const ts = /** @type {Record<string, unknown>} */ (meta).toolSecurity;
      if (ts && typeof ts === 'object') {
        return normalizeShellSandboxMode(
          /** @type {Record<string, unknown>} */ (ts).shellSandbox,
          'off',
        );
      }
    }
  } catch {
    /* ignore */
  }
  return 'off';
}

/**
 * Persisted "Always allow" for prefer-mode unsandboxed fallback (MIN-553 Phase 3).
 * @returns {Promise<boolean>}
 */
export async function getAllowUnsandboxedShellFromConfig() {
  try {
    const meta = await readConfigJson('config.json');
    if (meta && typeof meta === 'object') {
      const ts = /** @type {Record<string, unknown>} */ (meta).toolSecurity;
      if (ts && typeof ts === 'object') {
        return /** @type {Record<string, unknown>} */ (ts).allowUnsandboxedShell === true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Autopilot default for board shell sandbox (default require).
 * @returns {Promise<'off'|'prefer'|'require'>}
 */
export async function getAutopilotShellSandboxFromConfig() {
  try {
    const meta = await readConfigJson('config.json');
    if (meta && typeof meta === 'object') {
      const ap = /** @type {Record<string, unknown>} */ (meta).autopilot;
      if (ap && typeof ap === 'object') {
        return normalizeShellSandboxMode(
          /** @type {Record<string, unknown>} */ (ap).shellSandbox,
          'require',
        );
      }
    }
  } catch {
    /* ignore */
  }
  return 'require';
}
