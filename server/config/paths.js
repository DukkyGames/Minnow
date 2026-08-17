/**
 * Safe path resolution for files under MINNOW_HOME (config API whitelist).
 */

import path from 'node:path';
import { getMinnowHome } from './home.js';

/** Relative keys allowed for generic read/write in Step 02. */
export const ALLOWED_CONFIG_FILES = new Set([
  'config.json',
  // sessions/state.json removed in A.2 — SQLite via sessions-paths.js bypasses this allowlist.
  // resourceToRelativeKey('sessions') still returns 'sessions/state.json' for JSON rollback.
  'tools.json',
  'search.json',
  'servers.json',
  'research.json',
  'skills.json',
  'system-prompt.json',
  'rules.json',
  'sub-agents.json',
  'bugs/state.json',
  'issues/state.json',
  'issues/taxonomy.json',
  'onboarding.json',
]);

/**
 * Map API resource segments to on-disk relative keys.
 * @param {string} resource
 * @returns {string | null}
 */
export function resourceToRelativeKey(resource) {
  switch (resource) {
    case 'meta':
      return 'config.json';
    case 'sessions':
      return 'sessions/state.json';
    case 'tools':
      return 'tools.json';
    case 'search':
      return 'search.json';
    case 'servers':
      return 'servers.json';
    case 'research':
      return 'research.json';
    case 'skills':
      return 'skills.json';
    case 'system-prompt':
      return 'system-prompt.json';
    case 'rules':
      return 'rules.json';
    case 'sub-agents':
      return 'sub-agents.json';
    case 'bugs':
      return 'bugs/state.json';
    case 'issues':
      return 'issues/state.json';
    case 'issues-taxonomy':
      return 'issues/taxonomy.json';
    default:
      return null;
  }
}

/** Directory holding pre-migration copies of issues/state.json. */
export const ISSUES_BACKUP_DIRNAME = 'issues/backups';

/**
 * Absolute path for one issues-schema backup.
 *
 * Not routed through {@link ALLOWED_CONFIG_FILES}: that allowlist gates
 * client-addressable resources, and backup names are built server-side from a
 * schema number and a clock. Both inputs are coerced to integers here so the
 * filename can never carry a path segment.
 *
 * @param {number} fromVersion schema revision being replaced
 * @param {number} stamp epoch milliseconds
 * @returns {string}
 */
export function issuesBackupPath(fromVersion, stamp) {
  const version = Number.isFinite(fromVersion) ? Math.trunc(Math.abs(fromVersion)) : 0;
  const at = Number.isFinite(stamp) ? Math.trunc(Math.abs(stamp)) : 0;
  const home = path.resolve(getMinnowHome());
  const full = path.resolve(home, ISSUES_BACKUP_DIRNAME, `state.v${version}.${at}.json`);
  const homeWithSep = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  if (!full.startsWith(homeWithSep)) {
    throw new Error('Invalid config path');
  }
  return full;
}

/** Absolute path of the issues backup directory. */
export function issuesBackupDir() {
  return path.resolve(path.resolve(getMinnowHome()), ISSUES_BACKUP_DIRNAME);
}

/**
 * Resolve a relative config key to an absolute path under home.
 * @param {string} relativeKey
 * @returns {string}
 */
export function resolveConfigPath(relativeKey) {
  if (!relativeKey || typeof relativeKey !== 'string') {
    throw new Error('Invalid config path');
  }

  if (relativeKey.includes('\0')) {
    throw new Error('Invalid config path');
  }

  if (path.isAbsolute(relativeKey)) {
    throw new Error('Invalid config path');
  }

  const normalized = relativeKey.replace(/\\/g, '/').replace(/^\/+/, '');

  if (!normalized || normalized.includes('..')) {
    throw new Error('Invalid config path');
  }

  if (!ALLOWED_CONFIG_FILES.has(normalized)) {
    throw new Error('Invalid config path');
  }

  const home = path.resolve(getMinnowHome());
  const full = path.resolve(home, normalized);
  const homeWithSep = home.endsWith(path.sep) ? home : `${home}${path.sep}`;

  if (full !== home && !full.startsWith(homeWithSep)) {
    throw new Error('Invalid config path');
  }

  return full;
}
