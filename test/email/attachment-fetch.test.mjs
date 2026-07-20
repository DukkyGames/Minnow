/**
 * Attachment download — filename hardening, index/cid selection (MIN-353).
 *
 * Run with --experimental-test-module-mocks (see test/run-all.mjs).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

const ACCOUNT_ID = 'acct-attachment-fetch';

const ACCOUNT = {
  id: ACCOUNT_ID,
  username: 'me@example.com',
  address: 'me@example.com',
  folders: ['INBOX'],
  imap: { host: 'imap.example.com', port: 993, tls: true },
};

let tempHome;
let savedHome;

/** Raw source served by the fake IMAP client, keyed by uid. */
const sources = new Map();

/**
 * A multipart message with one real attachment and one inline image.
 * Written by hand so the test does not depend on a MIME builder.
 */
function multipartSource({ filename = 'report.pdf' } = {}) {
  const boundary = 'bnd42';
  return [
    'From: Alice <alice@example.com>',
    'To: me@example.com',
    'Subject: Contract',
    'Message-ID: <att-1@example.com>',
    'Date: Wed, 01 Jul 2026 10:00:00 +0000',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'See the attached contract.',
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    Buffer.from('PDF-BYTES').toString('base64'),
    '',
    `--${boundary}`,
    'Content-Type: image/png; name="logo.png"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: inline; filename="logo.png"',
    'Content-ID: <logo@sig>',
    '',
    Buffer.from('PNG-BYTES').toString('base64'),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

const fakeClient = {
  async fetchOne(uid, query) {
    const source = sources.get(Number(uid));
    if (!source) return null;
    return query.source ? { uid: Number(uid), source: Buffer.from(source) } : { uid: Number(uid) };
  },
};

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-attach-'));
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
      listFoldersCached: async () => [{ path: 'INBOX', name: 'INBOX', specialUse: null }],
    },
  });
});

after(async () => {
  const { closeMailDbs } = await import('../../server/email/store.js');
  closeMailDbs();
  mock.reset();
  if (savedHome === undefined) {
    delete process.env.MINNOW_HOME;
  } else {
    process.env.MINNOW_HOME = savedHome;
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});

beforeEach(async () => {
  const { writeMessageCache } = await import('../../server/email/cache.js');
  await writeMessageCache(ACCOUNT_ID, { messages: [], folderCursors: {} });
  sources.clear();
});

/** Seed one cached message whose source the fake server will serve. */
async function seedMessage(source) {
  const { mergeMessagesIntoCache } = await import('../../server/email/cache.js');
  sources.set(1, source);
  await mergeMessagesIntoCache(
    ACCOUNT_ID,
    [
      {
        uid: '1',
        folder: 'INBOX',
        messageId: '<att-1@example.com>',
        threadId: '<att-1@example.com>',
        from: 'Alice <alice@example.com>',
        to: ['me@example.com'],
        subject: 'Contract',
        date: '2026-07-01T10:00:00.000Z',
        bodyPreview: 'See the attached contract.',
        flags: { seen: false, flagged: false, answered: false },
      },
    ],
    'INBOX',
    1,
  );
}

describe('safeAttachmentFilename', () => {
  test('neutralizes traversal, separators, and header injection', async () => {
    const { safeAttachmentFilename } = await import('../../server/email/attachment-fetch.js');

    assert.equal(safeAttachmentFilename('../../etc/passwd'), '_.._etc_passwd');
    assert.equal(safeAttachmentFilename('C:\\Windows\\system32\\bad.exe'), 'C__Windows_system32_bad.exe');
    assert.equal(safeAttachmentFilename('...hidden'), 'hidden');
    assert.equal(safeAttachmentFilename(''), 'attachment');

    // A raw CRLF in the filename would otherwise forge a response header.
    const injected = safeAttachmentFilename('a\r\nX-Evil: 1.txt');
    assert.ok(!injected.includes('\r'), 'carriage return is stripped');
    assert.ok(!injected.includes('\n'), 'line feed is stripped');
  });

  test('caps absurdly long names', async () => {
    const { safeAttachmentFilename } = await import('../../server/email/attachment-fetch.js');
    assert.equal(safeAttachmentFilename('a'.repeat(500)).length, 200);
  });
});

describe('fetchMessageAttachment', () => {
  test('returns the bytes of the part at the given index', async () => {
    const { fetchMessageAttachment } = await import('../../server/email/attachment-fetch.js');
    await seedMessage(multipartSource());

    const attachment = await fetchMessageAttachment(ACCOUNT_ID, 'INBOX:1', { index: 0 });

    assert.equal(attachment.filename, 'report.pdf');
    assert.equal(attachment.contentType, 'application/pdf');
    assert.equal(attachment.content.toString(), 'PDF-BYTES');
    assert.equal(attachment.size, 9);
    assert.equal(attachment.inline, false);
  });

  test('resolves an inline part by Content-ID for cid: body sources', async () => {
    const { fetchMessageAttachment } = await import('../../server/email/attachment-fetch.js');
    await seedMessage(multipartSource());

    const logo = await fetchMessageAttachment(ACCOUNT_ID, 'INBOX:1', { contentId: 'logo@sig' });

    assert.equal(logo.contentType, 'image/png');
    assert.equal(logo.content.toString(), 'PNG-BYTES');
    assert.equal(logo.inline, true);

    // Angle brackets are how the header carries it; both forms must work.
    const bracketed = await fetchMessageAttachment(ACCOUNT_ID, 'INBOX:1', {
      contentId: '<logo@sig>',
    });
    assert.equal(bracketed.content.toString(), 'PNG-BYTES');
  });

  test('sanitizes a hostile filename on the way out', async () => {
    const { fetchMessageAttachment } = await import('../../server/email/attachment-fetch.js');
    await seedMessage(multipartSource({ filename: '../../evil.sh' }));

    const attachment = await fetchMessageAttachment(ACCOUNT_ID, 'INBOX:1', { index: 0 });
    assert.equal(attachment.filename, '_.._evil.sh');
  });

  test('rejects an out-of-range index rather than serving the wrong part', async () => {
    const { fetchMessageAttachment } = await import('../../server/email/attachment-fetch.js');
    await seedMessage(multipartSource());

    await assert.rejects(
      () => fetchMessageAttachment(ACCOUNT_ID, 'INBOX:1', { index: 9 }),
      /Attachment not found/,
    );
    await assert.rejects(
      () => fetchMessageAttachment(ACCOUNT_ID, 'INBOX:1', { index: -1 }),
      /Attachment not found/,
    );
    await assert.rejects(
      () => fetchMessageAttachment(ACCOUNT_ID, 'INBOX:1', { contentId: 'nope@x' }),
      /Attachment not found/,
    );
  });

  test('rejects an unknown message key', async () => {
    const { fetchMessageAttachment } = await import('../../server/email/attachment-fetch.js');
    await assert.rejects(
      () => fetchMessageAttachment(ACCOUNT_ID, 'INBOX:404', { index: 0 }),
      /Cached message not found/,
    );
  });
});

describe('attachment metadata persistence', () => {
  test('stores contentId and inline, and inline-only mail is not "has attachments"', async () => {
    const { saveCachedBody, getCachedMessage } = await import('../../server/email/cache.js');
    await seedMessage(multipartSource());

    await saveCachedBody(ACCOUNT_ID, 'INBOX:1', {
      bodyText: 'See the attached contract.',
      complete: true,
      attachments: [
        { filename: 'logo.png', contentType: 'image/png', size: 9, contentId: 'logo@sig', inline: true },
      ],
    });

    const message = await getCachedMessage(ACCOUNT_ID, 'INBOX:1');
    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].contentId, 'logo@sig');
    assert.equal(message.attachments[0].inline, true);
    assert.equal(message.attachments[0].index, 0);
    assert.equal(
      message.hasAttachments,
      false,
      'a signature logo must not make the row show a paperclip',
    );
  });
});
