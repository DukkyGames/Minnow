/**
 * Email transport router — password IMAP/SMTP vs OAuth Gmail/Graph backends.
 */

import { getEmailAccount } from './accounts.js';
import * as imap from './imap.js';
import * as gmail from './gmail-api.js';
import * as graphMail from './graph-mail.js';

/**
 * @param {import('./accounts.js').EmailAccount} account
 */
function resolveBackend(account) {
  if (account.authType === 'oauth') {
    if (account.provider === 'microsoft') {
      return 'graph';
    }
    return 'gmail';
  }
  return 'imap';
}

/** @param {string} accountId */
export async function testEmailConnection(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const backend = resolveBackend(account);
  if (backend === 'graph') {
    return graphMail.testGraphMailConnection(accountId);
  }
  if (backend === 'gmail') {
    return gmail.testGmailConnection(accountId);
  }
  return imap.testImapConnection(accountId);
}

/** @param {string} accountId */
export async function listEmailFolders(accountId) {
  const account = await getEmailAccount(accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  const backend = resolveBackend(account);
  if (backend === 'graph') {
    return graphMail.listGraphMailFolders(accountId);
  }
  if (backend === 'gmail') {
    return gmail.listGmailFolders(accountId);
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
  const backend = resolveBackend(account);
  if (backend === 'graph') {
    return graphMail.syncGraphMailFolder(accountId, options);
  }
  if (backend === 'gmail') {
    return gmail.syncGmailFolder(accountId, options);
  }
  return imap.syncFolderMessages(accountId, options);
}

/**
 * @param {import('./accounts.js').EmailAccount} account
 * @param {{ to: string, subject: string, body: string, inReplyTo?: string, references?: string }} mail
 */
export async function sendOAuthEmail(account, mail) {
  const backend = resolveBackend(account);
  if (backend === 'graph') {
    return graphMail.sendGraphMailMessage(account, mail);
  }
  if (backend === 'gmail') {
    return gmail.sendGmailMessage(account, mail);
  }
  throw new Error('OAuth send is not available for password-based accounts');
}
