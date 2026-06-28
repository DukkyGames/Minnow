/**
 * IMAP error formatting tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatImapError } from '../../server/email/imap-errors.js';

/** @type {import('../../server/email/accounts.js').EmailAccount} */
const gmailAccount = {
  id: 'acct-1',
  label: 'Gmail',
  username: 'user@gmail.com',
  secretRef: 'secret',
  imap: { host: 'imap.gmail.com', port: 993, tls: true },
  isDefault: true,
  pollingEnabled: false,
  pollingIntervalMinutes: 15,
  folders: ['INBOX'],
};

/** @type {import('../../server/email/accounts.js').EmailAccount} */
const outlookAccount = {
  ...gmailAccount,
  label: 'Outlook',
  username: 'user@outlook.com',
  imap: { host: 'outlook.office365.com', port: 993, tls: true },
};

describe('formatImapError', () => {
  test('maps imapflow auth failure to Gmail app-password guidance', () => {
    const message = formatImapError(gmailAccount, {
      message: 'Command failed',
      responseText: 'Invalid credentials (Failure)',
      authenticationFailed: true,
    });
    assert.match(message, /App Password/i);
    assert.match(message, /Invalid credentials/);
  });

  test('maps Microsoft basic-auth failures to actionable guidance', () => {
    const message = formatImapError(outlookAccount, {
      message: 'Command failed',
      responseText: 'Authentication unsuccessful',
      authenticationFailed: true,
    });
    assert.match(message, /Microsoft no longer accepts normal mailbox passwords/i);
  });

  test('uses responseText instead of generic Command failed', () => {
    const message = formatImapError(gmailAccount, {
      message: 'Command failed',
      responseText: 'Mailbox does not exist',
    });
    assert.equal(message, 'IMAP error: Mailbox does not exist');
  });

  test('formats connection refused errors', () => {
    const message = formatImapError(gmailAccount, { code: 'ECONNREFUSED' });
    assert.match(message, /connection refused/i);
    assert.match(message, /imap\.gmail\.com:993/);
  });
});
