/**
 * Sent-folder APPEND and outgoing attachments (MIN-353).
 *
 * Run with --experimental-test-module-mocks (see test/run-all.mjs).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

const ACCOUNT_ID = 'acct-sent-append';

const ACCOUNT = {
  id: ACCOUNT_ID,
  username: 'me@example.com',
  fromAddress: 'Me <me@example.com>',
  folders: ['INBOX'],
  imap: { host: 'imap.example.com', port: 993, tls: true },
  smtp: { host: 'smtp.example.com', port: 587, starttls: true },
};

/** Folder lists the fake session returns; swapped per test. */
let folderList;

/** Every `client.append(...)` the code under test performed. */
let appends;

/** Every message handed to the fake SMTP transport. */
let sent;

let tempHome;
let savedHome;

const fakeClient = {
  async append(folderPath, raw, flags) {
    appends.push({ folder: folderPath, raw, flags });
    return { uid: 1 };
  },
};

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-sent-'));
  process.env.MINNOW_HOME = tempHome;

  mock.module('../../server/email/accounts.js', {
    namedExports: {
      getEmailAccount: async () => ACCOUNT,
      readAccountPassword: async () => 'pw',
      listEmailAccounts: async () => [ACCOUNT],
    },
  });

  mock.module('../../server/email/imap-session.js', {
    namedExports: {
      withMailbox: async (_accountId, _folder, fn) => fn(fakeClient, ACCOUNT),
      listFoldersCached: async () => folderList,
    },
  });

  mock.module('nodemailer', {
    defaultExport: {
      createTransport: () => ({
        async sendMail(options) {
          sent.push(options);
          return { messageId: '<sent@example.com>', accepted: ['b@example.com'], rejected: [] };
        },
      }),
    },
  });
});

after(async () => {
  mock.reset();
  if (savedHome === undefined) {
    delete process.env.MINNOW_HOME;
  } else {
    process.env.MINNOW_HOME = savedHome;
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});

beforeEach(() => {
  appends = [];
  sent = [];
  folderList = [
    { path: 'INBOX', name: 'INBOX', specialUse: null },
    { path: 'Sent Items', name: 'Sent Items', specialUse: '\\Sent' },
    { path: 'Trash', name: 'Trash', specialUse: '\\Trash' },
  ];
});

describe('resolveMailFolder — sent role', () => {
  test('prefers the \\Sent special-use flag over any name', async () => {
    const { resolveMailFolder } = await import('../../server/email/imap-actions.js');
    assert.equal(resolveMailFolder(folderList, '', 'sent'), 'Sent Items');
  });

  test('falls back to conventional names when no flag is advertised', async () => {
    const { resolveMailFolder } = await import('../../server/email/imap-actions.js');
    const unflagged = [
      { path: 'INBOX', name: 'INBOX', specialUse: null },
      { path: 'Sent', name: 'Sent', specialUse: null },
    ];
    assert.equal(resolveMailFolder(unflagged, '', 'sent'), 'Sent');
  });

  test('resolves the Gmail sent path by name', async () => {
    const { resolveMailFolder } = await import('../../server/email/imap-actions.js');
    const gmail = [
      { path: 'INBOX', name: 'INBOX', specialUse: null },
      { path: '[Gmail]/Sent Mail', name: 'Sent Mail', specialUse: null },
    ];
    assert.equal(resolveMailFolder(gmail, '', 'sent'), '[Gmail]/Sent Mail');
  });
});

describe('providerSelfFilesSent', () => {
  test('detects a Gmail-shaped mailbox by its \\All folder', async () => {
    const { providerSelfFilesSent } = await import('../../server/email/imap-actions.js');
    assert.equal(providerSelfFilesSent(folderList), false);
    assert.equal(
      providerSelfFilesSent([...folderList, { path: '[Gmail]/All Mail', name: 'All Mail', specialUse: '\\All' }]),
      true,
    );
  });
});

describe('appendToSentFolder', () => {
  test('appends the raw bytes as \\Seen', async () => {
    const { appendToSentFolder } = await import('../../server/email/imap-actions.js');
    const raw = Buffer.from('Subject: hi\r\n\r\nbody');

    const result = await appendToSentFolder(ACCOUNT_ID, raw);

    assert.deepEqual(result, { appended: true, folder: 'Sent Items' });
    assert.equal(appends.length, 1);
    assert.equal(appends[0].folder, 'Sent Items');
    assert.equal(appends[0].raw.toString(), 'Subject: hi\r\n\r\nbody');
    assert.deepEqual(appends[0].flags, ['\\Seen']);
  });

  test('skips providers that file sent mail themselves', async () => {
    const { appendToSentFolder } = await import('../../server/email/imap-actions.js');
    folderList = [
      { path: 'INBOX', name: 'INBOX', specialUse: null },
      { path: '[Gmail]/All Mail', name: 'All Mail', specialUse: '\\All' },
      { path: '[Gmail]/Sent Mail', name: 'Sent Mail', specialUse: '\\Sent' },
    ];

    const result = await appendToSentFolder(ACCOUNT_ID, Buffer.from('x'));

    assert.deepEqual(result, { appended: false, reason: 'provider_self_files' });
    assert.equal(appends.length, 0, 'no duplicate is filed');
  });

  test('reports rather than throws when the server refuses the APPEND', async () => {
    const { appendToSentFolder } = await import('../../server/email/imap-actions.js');
    const failing = mock.method(fakeClient, 'append', async () => {
      throw new Error('OVERQUOTA');
    });

    const result = await appendToSentFolder(ACCOUNT_ID, Buffer.from('x'));

    assert.equal(result.appended, false);
    assert.equal(result.error, 'OVERQUOTA');
    failing.mock.restore();
  });

  test('reports when the account has no sent folder at all', async () => {
    const { appendToSentFolder } = await import('../../server/email/imap-actions.js');
    folderList = [{ path: 'INBOX', name: 'INBOX', specialUse: null }];

    const result = await appendToSentFolder(ACCOUNT_ID, Buffer.from('x'));
    assert.deepEqual(result, { appended: false, reason: 'no_sent_folder' });
  });
});

describe('buildOutgoingAttachments', () => {
  test('decodes base64 content and marks inline parts with a cid', async () => {
    const { buildOutgoingAttachments } = await import('../../server/email/smtp.js');

    const parts = buildOutgoingAttachments([
      { filename: 'a.txt', contentType: 'text/plain', content: Buffer.from('hello').toString('base64') },
      { filename: 'logo.png', contentType: 'image/png', content: 'AAA=', contentId: 'logo@sig' },
    ]);

    assert.equal(parts.length, 2);
    assert.equal(parts[0].content.toString(), 'hello');
    assert.equal(parts[0].cid, undefined);
    assert.equal(parts[1].cid, 'logo@sig');
    assert.equal(parts[1].contentDisposition, 'inline');
  });

  test('refuses a payload over the size cap', async () => {
    const { buildOutgoingAttachments, MAX_OUTGOING_ATTACHMENT_BYTES } = await import(
      '../../server/email/smtp.js'
    );

    const oversized = Buffer.alloc(MAX_OUTGOING_ATTACHMENT_BYTES + 1).toString('base64');
    assert.throws(
      () => buildOutgoingAttachments([{ filename: 'big.bin', content: oversized }]),
      /exceed/i,
    );
  });

  test('treats a missing list as no attachments', async () => {
    const { buildOutgoingAttachments } = await import('../../server/email/smtp.js');
    assert.deepEqual(buildOutgoingAttachments(undefined), []);
    assert.deepEqual(buildOutgoingAttachments([]), []);
  });
});

describe('sendEmail', () => {
  test('files a Sent copy whose bytes match what SMTP received', async () => {
    const { sendEmail } = await import('../../server/email/smtp.js');

    const result = await sendEmail({
      accountId: ACCOUNT_ID,
      to: 'b@example.com',
      subject: 'Contract',
      body: 'Please sign.',
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.sentCopy, { appended: true, folder: 'Sent Items' });
    assert.equal(appends.length, 1);
    assert.equal(
      appends[0].raw.toString(),
      sent[0].raw.toString(),
      'the archived copy is the delivered message, byte for byte',
    );
  });

  test('keeps Bcc out of the message but inside the envelope', async () => {
    const { sendEmail } = await import('../../server/email/smtp.js');

    await sendEmail({
      accountId: ACCOUNT_ID,
      to: 'b@example.com',
      cc: 'c@example.com',
      bcc: 'secret@example.com',
      subject: 'Contract',
      body: 'Please sign.',
    });

    const envelope = sent[0].envelope;
    assert.ok(envelope.to.includes('secret@example.com'), 'the blind recipient is still delivered to');
    assert.ok(envelope.to.includes('c@example.com'));

    const wire = sent[0].raw.toString();
    assert.match(wire, /^Cc: /m, 'Cc is a visible header');
    assert.doesNotMatch(wire, /^Bcc: /m, 'Bcc must never appear on the wire');

    const filed = appends[0].raw.toString();
    assert.doesNotMatch(filed, /^Bcc: /m, 'nor in the Sent copy');
  });

  test('carries attachments into the composed message', async () => {
    const { sendEmail } = await import('../../server/email/smtp.js');

    await sendEmail({
      accountId: ACCOUNT_ID,
      to: 'b@example.com',
      subject: 'Deck',
      body: 'Attached.',
      attachments: [
        {
          filename: 'notes.txt',
          contentType: 'text/plain',
          content: Buffer.from('meeting notes').toString('base64'),
        },
      ],
    });

    const wire = sent[0].raw.toString();
    assert.match(wire, /notes\.txt/, 'the filename reaches the wire');
    assert.match(wire, /bWVldGluZyBub3Rlcw==|meeting notes/, 'the content is encoded into the body');
  });

  test('still reports success when the Sent copy cannot be filed', async () => {
    const { sendEmail } = await import('../../server/email/smtp.js');
    const failing = mock.method(fakeClient, 'append', async () => {
      throw new Error('NO permission denied');
    });

    const result = await sendEmail({
      accountId: ACCOUNT_ID,
      to: 'b@example.com',
      subject: 'Contract',
      body: 'Please sign.',
    });

    assert.equal(result.ok, true, 'a filing failure is not a send failure');
    assert.equal(result.sentCopy.appended, false);
    assert.match(result.sentCopy.error, /permission denied/);
    failing.mock.restore();
  });
});
