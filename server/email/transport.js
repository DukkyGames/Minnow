/**
 * Email transport — IMAP read sync and folder listing.
 */

import { getEmailAccount } from './accounts.js';
import * as imap from './imap.js';

/** @param {string} accountId */
export async function testEmailConnection(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  return imap.testImapConnection(accountId);
}

/** @param {string} accountId */
export async function listEmailFolders(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  return imap.listImapFolders(accountId);
}

/**
 * @param {string} accountId
 * @param {{ folder?: string, limit?: number, offset?: number }} options
 */
export async function syncFolderMessages(accountId, options = {}) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  return imap.syncFolderMessages(accountId, options);
}

/**
 * Download the full body for a message on first open (sync stores headers +
 * a text preview only).
 * @param {string} accountId
 * @param {string} messageKey
 * @param {{ force?: boolean }} [options]
 */
export async function loadMessageBody(accountId, messageKey, options = {}) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  return imap.ensureMessageBody(accountId, messageKey, options);
}
