/**
 * Filesystem paths for email accounts, secrets, and message cache.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Root email data directory under ~/.minnow/email. */
export function emailRootDir() {
  return path.join(getMinnowHome(), 'email');
}

/** Account registry JSON (no passwords). */
export function emailAccountsPath() {
  return path.join(emailRootDir(), 'accounts.json');
}

/** Encrypted password envelope for one account. */
export function emailSecretPath(accountId) {
  return path.join(emailRootDir(), 'secrets', `${accountId}.json`);
}

/** Per-account message cache directory. */
export function emailCacheDir(accountId) {
  return path.join(emailRootDir(), 'cache', accountId);
}

/** Cached messages + folder cursors for one account. */
export function emailCacheMessagesPath(accountId) {
  return path.join(emailCacheDir(accountId), 'messages.json');
}

/** Automation rules registry. */
export function emailAutomationsPath() {
  return path.join(emailRootDir(), 'automations.json');
}
