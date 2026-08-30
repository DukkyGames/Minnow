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
  'reviews/state.json',
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
    case 'reviews':
      return 'reviews/state.json';
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

/** Directory holding image and file attachments, one folder per issue. */
export const ISSUES_ATTACHMENTS_DIRNAME = 'issues/attachments';

/**
 * Strip a name down to something that can only ever be one path segment.
 *
 * Not an escape: separators, dots and control characters are removed outright
 * rather than encoded, because nothing downstream needs to recover the original
 * and a lossy name is a much smaller problem than a traversal.
 *
 * @param {unknown} raw
 * @param {string} fallback
 * @returns {string}
 */
export function sanitizeAttachmentSegment(raw, fallback = 'file') {
  const text = typeof raw === 'string' ? raw : '';
  const cleaned = text
    // Anything outside this set — separators, control characters, spaces,
    // Unicode — collapses to a dash. Removing rather than encoding is fine:
    // nothing downstream needs the original name back.
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    // Leading dots would make a hidden file, and `..` a traversal.
    .replace(/^[.-]+/, '')
    .slice(0, 96);
  return cleaned || fallback;
}

/**
 * Absolute path for one issue attachment.
 *
 * Both segments are sanitized here rather than at the call site, for the same
 * reason as {@link issuesBackupPath}: this is the only place that can be sure,
 * and a client-supplied filename is exactly the input that must never reach
 * `path.resolve` intact.
 *
 * @param {string} issueId
 * @param {string} fileName
 * @returns {string}
 */
export function issuesAttachmentPath(issueId, fileName) {
  const issueSegment = sanitizeAttachmentSegment(issueId, 'issue');
  const nameSegment = sanitizeAttachmentSegment(fileName, 'file');
  const home = path.resolve(getMinnowHome());
  const full = path.resolve(home, ISSUES_ATTACHMENTS_DIRNAME, issueSegment, nameSegment);
  const homeWithSep = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  if (!full.startsWith(homeWithSep)) {
    throw new Error('Invalid attachment path');
  }
  return full;
}

/**
 * Absolute path for an attachment addressed by its stored relative key
 * (`<issueId>/<name>`). Rejects anything that is not exactly two safe segments.
 *
 * @param {string} relativeKey
 * @returns {string}
 */
export function resolveIssueAttachmentPath(relativeKey) {
  if (typeof relativeKey !== 'string' || !relativeKey.trim()) {
    throw new Error('Invalid attachment path');
  }
  const parts = relativeKey.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length !== 2) throw new Error('Invalid attachment path');
  return issuesAttachmentPath(parts[0], parts[1]);
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
