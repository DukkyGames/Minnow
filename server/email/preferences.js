/**
 * Email app preferences — persisted in ~/.minnow/email/preferences.json.
 *
 * These are global reader/privacy choices, distinct from per-account connection
 * settings in accounts.json and the per-sender image allowlist.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { emailPreferencesPath } from './paths.js';

/** @typedef {{ alwaysLoadRemoteImages: boolean }} EmailPreferences */

/** @type {EmailPreferences} */
const DEFAULTS = {
  alwaysLoadRemoteImages: false,
};

/**
 * @param {unknown} value
 * @returns {EmailPreferences}
 */
function normalizePreferences(value) {
  const row = value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
  return {
    alwaysLoadRemoteImages: row.alwaysLoadRemoteImages === true,
  };
}

/** @returns {Promise<EmailPreferences>} */
export async function getEmailPreferences() {
  try {
    const raw = await fs.readFile(emailPreferencesPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return normalizePreferences(parsed);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { ...DEFAULTS };
    }
    throw err;
  }
}

/**
 * Merge partial updates into the stored preferences.
 *
 * @param {Partial<EmailPreferences>} patch
 * @returns {Promise<EmailPreferences>}
 */
export async function updateEmailPreferences(patch) {
  const current = await getEmailPreferences();
  const next = normalizePreferences({ ...current, ...patch });
  const filePath = emailPreferencesPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(
    tmp,
    `${JSON.stringify({ version: 1, ...next, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(tmp, filePath);
  return next;
}
