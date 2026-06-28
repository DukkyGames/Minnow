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
