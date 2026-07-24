/**
 * mark-all-read chunking and empty/partial results (mocked IMAP STORE).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/** Keys seen by the mocked bulk STORE, for chunk assertions. */
const bulkCalls = [];

mock.module('../../server/email/imap-actions.js', {
  namedExports: {
    setImapMessageFlagsBulk: async (_accountId, keys) => {
      bulkCalls.push([...keys]);
      return keys.map((id, index) =>
        // Fail the middle id of the first chunk so partial failure is visible.
        bulkCalls.length === 1 && index === 1
          ? { id, ok: false, error: 'boom' }
          : { id, ok: true, flags: { seen: true } },
      );
    },
    archiveImapMessage: async () => ({ ok: true }),
    deleteImapMessage: async () => ({ ok: true }),
    moveImapMessage: async () => ({ ok: true }),
    setImapMessageFlags: async () => ({ ok: true }),
    resolveMailFolder: (_folders, preferred) => preferred,
  },
});

const {
  listUnreadMessageIds,
  mergeMessagesIntoCache,
  writeMessageCache,
} = await import('../../server/email/cache.js');
const { markAllMessagesRead } = await import('../../server/email/mail-actions.js');
const { closeMailDbs } = await import('../../server/email/store.js');

const ACCOUNT_ID = 'acct-mark-all-read';

let tempHome;
let savedHome;

function message(overrides = {}) {
  return {
    uid: '1',
    folder: 'INBOX',
    messageId: '<a@example.com>',
    threadId: '<thread-a@example.com>',
    from: 'Alice <alice@example.com>',
    to: ['me@example.com'],
    subject: 'Hello',
    date: '2026-07-01T10:00:00.000Z',
    bodyPreview: 'preview',
    bodyText: 'body text',
    bodyHash: 'hash',
    hasAttachments: false,
    attachments: [],
    inReplyTo: '',
    references: [],
    flags: { seen: false, flagged: false, answered: false },
    ...overrides,
  };
}

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-mark-all-'));
  process.env.MINNOW_HOME = tempHome;
});

after(async () => {
  closeMailDbs();
  if (savedHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = savedHome;
  await fs.rm(tempHome, { recursive: true, force: true });
});

beforeEach(async () => {
  bulkCalls.length = 0;
  await writeMessageCache(ACCOUNT_ID, { messages: [], folderCursors: {} });
});

describe('markAllMessagesRead', () => {
  test('empty unread set succeeds with zero counts', async () => {
    const result = await markAllMessagesRead(ACCOUNT_ID, { folder: 'INBOX' });
    assert.deepEqual(result, { ok: true, attempted: 0, updated: 0, failed: 0 });
    assert.equal(bulkCalls.length, 0);
  });

  test('reports attempted / updated / failed for a partial STORE failure', async () => {
    const rows = [];
    for (let i = 1; i <= 3; i += 1) {
      rows.push(
        message({
          uid: String(i),
          messageId: `<m${i}@x>`,
          threadId: `<t${i}@x>`,
          date: `2026-07-0${i}T10:00:00.000Z`,
        }),
      );
    }
    await mergeMessagesIntoCache(ACCOUNT_ID, rows, 'INBOX', 3);
    assert.equal(listUnreadMessageIds(ACCOUNT_ID, { folder: 'INBOX' }).length, 3);

    const result = await markAllMessagesRead(ACCOUNT_ID, { folder: 'INBOX' });
    assert.equal(result.attempted, 3);
    assert.equal(result.updated, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.ok, false);
    assert.equal(bulkCalls.length, 1);
  });
});
