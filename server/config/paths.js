/**
 * Safe path resolution for files under MINNOW_HOME (config API whitelist).
 */

import path from 'node:path';
import { getMinnowHome } from './home.js';

/** Relative keys allowed for generic read/write in Step 02. */
export const ALLOWED_CONFIG_FILES = new Set([
  'config.json',
  'sessions/state.json',
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
    default:
      return null;
  }
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
