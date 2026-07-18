/**
 * SQLite mail store — identity, FTS search, thread rollups, concurrency (MIN-351).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  countCachedMessages,
  getCachedBody,
  getCachedMessage,
  getFolderUnreadCounts,
  getSyncState,
  listCachedMessages,
  listCachedThread,
  listCachedThreads,
  listCachedUids,
  mergeMessagesIntoCache,
  migrateJsonCacheIfNeeded,
  reconcileFolderFlags,
  removeMessageFromCache,
  resetFolderCache,
  saveCachedBody,
  searchCachedMessages,
  setSyncState,
  updateMessageFlags,
  updateMessageFolder,
  updateMessageTriage,
  updateReplyVariants,
  writeMessageCache,
} from '../../server/email/cache.js';
import { closeMailDbs } from '../../server/email/store.js';
import { emailCacheMessagesPath } from '../../server/email/paths.js';

const ACCOUNT_ID = 'acct-mail-store-test';

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
    subject: 'Quarterly contract',
    date: '2026-07-01T10:00:00.000Z',
    bodyPreview: 'Please review the contract',
    bodyText: 'Please review the contract before Friday.',
    bodyHash: 'hash-a',
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
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-mail-store-'));
  process.env.MINNOW_HOME = tempHome;
});

after(async () => {
  closeMailDbs();
  if (savedHome === undefined) {
    delete process.env.MINNOW_HOME;
  } else {
    process.env.MINNOW_HOME = savedHome;
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});

beforeEach(async () => {
  await writeMessageCache(ACCOUNT_ID, { messages: [], folderCursors: {} });
});

describe('mail store identity', () => {
  test('assigns folder:uid ids and keeps them stable across a move', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);

    const before = await getCachedMessage(ACCOUNT_ID, 'INBOX:1');
    assert.equal(before.id, 'INBOX:1');
    await updateMessageTriage(ACCOUNT_ID, 'INBOX:1', { urgency: 'high', summary: 'Sign it' });

    await updateMessageFolder(ACCOUNT_ID, 'INBOX:1', 'Archive', '77');

    const moved = await getCachedMessage(ACCOUNT_ID, 'INBOX:1');
    assert.ok(moved, 'the original id still resolves after a move');
    assert.equal(moved.folder, 'Archive');
    assert.equal(moved.uid, '77');
    assert.equal(moved.triage.urgency, 'high', 'triage survives the move');
    assert.equal(moved.messageRowId, before.messageRowId);
  });

  test('same uid in two folders resolves to distinct messages (D4)', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [
        message({ uid: '5', folder: 'INBOX', subject: 'Inbox five', messageId: '<i5@x>' }),
        message({ uid: '5', folder: 'Sent', subject: 'Sent five', messageId: '<s5@x>' }),
      ],
      'INBOX',
      5,
    );

    const inbox = await getCachedMessage(ACCOUNT_ID, 'INBOX:5');
    const sent = await getCachedMessage(ACCOUNT_ID, 'Sent:5');
    assert.equal(inbox.subject, 'Inbox five');
    assert.equal(sent.subject, 'Sent five');

    // The ambiguous bare-uid form no longer silently picks the first match.
    assert.equal(await getCachedMessage(ACCOUNT_ID, '5'), null);
  });

  test('reply variants and triage hang off the stable row', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);
    await updateReplyVariants(ACCOUNT_ID, 'INBOX:1', [
      { id: 'v1', label: 'Brief yes', body: 'Sounds good.', createdAt: '2026-07-01T11:00:00.000Z' },
    ]);
    const row = await getCachedMessage(ACCOUNT_ID, 'INBOX:1');
    assert.equal(row.replyVariants.length, 1);
    assert.equal(row.replyVariants[0].label, 'Brief yes');
  });
});

describe('mail store queries', () => {
  test('FTS search matches body text, not just subject and sender (D10)', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [
        message({ uid: '1', bodyText: 'The invoice is attached for review.', bodyPreview: 'invoice' }),
        message({
          uid: '2',
          messageId: '<b@example.com>',
          threadId: '<thread-b@example.com>',
          subject: 'Lunch',
          bodyText: 'Want to grab lunch tomorrow?',
          bodyPreview: 'lunch',
        }),
      ],
      'INBOX',
      2,
    );

    const hits = await searchCachedMessages(ACCOUNT_ID, { query: 'invoice' });
    assert.equal(hits.total, 1);
    assert.equal(hits.messages[0].uid, '1');

    const none = await searchCachedMessages(ACCOUNT_ID, { query: 'nonexistentterm' });
    assert.equal(none.total, 0);
  });

  test('search reindexes when a lazy body arrives', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [message({ bodyText: 'preview only', bodyPreview: 'preview only' })],
      'INBOX',
      1,
    );
    assert.equal((await searchCachedMessages(ACCOUNT_ID, { query: 'zeppelin' })).total, 0);

    await saveCachedBody(ACCOUNT_ID, 'INBOX:1', {
      bodyText: 'The zeppelin schedule is confirmed.',
      bodyHtml: '<p>The zeppelin schedule is confirmed.</p>',
      complete: true,
    });

    assert.equal((await searchCachedMessages(ACCOUNT_ID, { query: 'zeppelin' })).total, 1);
    const body = await getCachedBody(ACCOUNT_ID, 'INBOX:1');
    assert.equal(body.complete, true);
    assert.match(body.bodyHtml, /zeppelin/);
  });

  test('a re-sync preview never overwrites a fully downloaded body', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message({ bodyText: 'preview text' })], 'INBOX', 1);
    await saveCachedBody(ACCOUNT_ID, 'INBOX:1', {
      bodyText: 'the complete plain body',
      bodyHtml: '<p>the complete body</p>',
      complete: true,
    });

    // The server re-reports the same uid; sync only ever carries the preview.
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [message({ bodyText: 'preview text', bodyComplete: false })],
      'INBOX',
      1,
    );

    const body = await getCachedBody(ACCOUNT_ID, 'INBOX:1');
    assert.equal(body.bodyText, 'the complete plain body');
    assert.equal(body.bodyHtml, '<p>the complete body</p>', 'the HTML part is not dropped');
    assert.equal(body.complete, true);
  });

  test('thread rollups track count, unread, and last date', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [
        message({ uid: '1', date: '2026-07-01T10:00:00.000Z' }),
        message({
          uid: '2',
          messageId: '<a2@example.com>',
          date: '2026-07-02T10:00:00.000Z',
          from: 'Bob <bob@example.com>',
          bodyPreview: 'Signed and returned',
          flags: { seen: true, flagged: false, answered: false },
        }),
      ],
      'INBOX',
      2,
    );

    const { threads, total } = await listCachedThreads(ACCOUNT_ID, {});
    assert.equal(total, 1);
    assert.equal(threads[0].messageCount, 2);
    assert.equal(threads[0].unreadCount, 1);
    assert.equal(threads[0].lastDate, '2026-07-02T10:00:00.000Z');
    assert.equal(threads[0].snippet, 'Signed and returned');
    assert.deepEqual(threads[0].participants, [
      'Alice <alice@example.com>',
      'Bob <bob@example.com>',
    ]);

    await updateMessageFlags(ACCOUNT_ID, 'INBOX:1', { seen: true, flagged: true });
    const after = await listCachedThreads(ACCOUNT_ID, {});
    assert.equal(after.threads[0].unreadCount, 0);
    assert.equal(after.threads[0].flagged, true);

    const ordered = await listCachedThread(ACCOUNT_ID, '<thread-a@example.com>');
    assert.deepEqual(
      ordered.map((row) => row.uid),
      ['1', '2'],
      'thread messages are oldest-first',
    );
  });

  test('unread counts and filters are folder-scoped', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [
        message({ uid: '1' }),
        message({ uid: '2', messageId: '<c@x>', folder: 'Archive', threadId: '<thread-c@x>' }),
      ],
      'INBOX',
      1,
    );

    assert.deepEqual(await getFolderUnreadCounts(ACCOUNT_ID), { INBOX: 1, Archive: 1 });
    const unread = await listCachedMessages(ACCOUNT_ID, { folder: 'INBOX', filter: 'unread' });
    assert.equal(unread.total, 1);
    assert.equal(await countCachedMessages(ACCOUNT_ID, 'Archive'), 1);
  });
});

describe('sync state and reconcile', () => {
  test('merge advances the folder cursor monotonically', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message({ uid: '9' })], 'INBOX', 9);
    assert.equal((await getSyncState(ACCOUNT_ID, 'INBOX')).highestUid, 9);

    await mergeMessagesIntoCache(ACCOUNT_ID, [], 'INBOX', 4);
    assert.equal(
      (await getSyncState(ACCOUNT_ID, 'INBOX')).highestUid,
      9,
      'a lower highestUid never rewinds the cursor',
    );

    await setSyncState(ACCOUNT_ID, 'INBOX', { uidValidity: '123', highestModseq: '77' });
    const state = await getSyncState(ACCOUNT_ID, 'INBOX');
    assert.equal(state.uidValidity, '123');
    assert.equal(state.highestUid, 9, 'a partial patch leaves other columns alone');
  });

  test('flags reconcile applies external reads and drops vanished messages', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [
        message({ uid: '1' }),
        message({ uid: '2', messageId: '<b@x>', threadId: '<thread-b@x>' }),
      ],
      'INBOX',
      2,
    );

    const serverFlags = new Map([[1, { seen: true, flagged: true, answered: false }]]);
    const result = await reconcileFolderFlags(ACCOUNT_ID, 'INBOX', serverFlags, [1, 2]);

    assert.equal(result.updated, 1);
    assert.equal(result.removed, 1, 'uid 2 is gone from the server, so it leaves the store');

    const kept = await getCachedMessage(ACCOUNT_ID, 'INBOX:1');
    assert.equal(kept.flags.seen, true);
    assert.equal(kept.flags.flagged, true);
    assert.equal(await getCachedMessage(ACCOUNT_ID, 'INBOX:2'), null);
  });

  test('uidvalidity reset clears the folder and its cursor', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message(), message({ uid: '2', messageId: '<b@x>' })], 'INBOX', 2);
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [message({ uid: '3', folder: 'Sent', messageId: '<s@x>', threadId: '<t-s@x>' })],
      'Sent',
      3,
    );

    await resetFolderCache(ACCOUNT_ID, 'INBOX');

    assert.equal(await countCachedMessages(ACCOUNT_ID, 'INBOX'), 0);
    assert.equal(await countCachedMessages(ACCOUNT_ID, 'Sent'), 1, 'other folders are untouched');
    assert.equal((await getSyncState(ACCOUNT_ID, 'INBOX')).highestUid, 0);
    assert.deepEqual(await listCachedUids(ACCOUNT_ID, 'INBOX'), []);
  });
});

describe('concurrent writers', () => {
  test('interleaved flag and triage writes both survive (D5)', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);

    await Promise.all([
      updateMessageFlags(ACCOUNT_ID, 'INBOX:1', { seen: true, flagged: false }),
      updateMessageTriage(ACCOUNT_ID, 'INBOX:1', { urgency: 'high', summary: 'Contract' }),
      updateReplyVariants(ACCOUNT_ID, 'INBOX:1', [
        { id: 'v1', label: 'Yes', body: 'ok', createdAt: '2026-07-01T11:00:00.000Z' },
      ]),
    ]);

    const row = await getCachedMessage(ACCOUNT_ID, 'INBOX:1');
    assert.equal(row.flags.seen, true, 'the flag write was not clobbered');
    assert.equal(row.triage.urgency, 'high', 'the triage write was not clobbered');
    assert.equal(row.replyVariants.length, 1, 'the variants write was not clobbered');
  });

  test('many parallel writers across messages lose no updates', async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      message({
        uid: String(index + 1),
        messageId: `<m${index}@example.com>`,
        threadId: `<thread-${index}@example.com>`,
      }),
    );
    await mergeMessagesIntoCache(ACCOUNT_ID, rows, 'INBOX', 25);

    await Promise.all(
      rows.map((row, index) =>
        updateMessageTriage(ACCOUNT_ID, `INBOX:${row.uid}`, { urgency: 'low', summary: `s${index}` }),
      ),
    );

    const { messages } = await listCachedMessages(ACCOUNT_ID, { limit: 200 });
    assert.equal(messages.length, 25);
    assert.equal(
      messages.filter((row) => row.triage?.summary).length,
      25,
      'every triage write landed',
    );
  });
});

describe('json migration', () => {
  test('imports a legacy messages.json once and retires the file', async () => {
    const legacyAccount = 'acct-legacy-json';
    const filePath = emailCacheMessagesPath(legacyAccount);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        folderCursors: { INBOX: { highestUid: 12 } },
        inboxSummary: { generatedAt: '2026-07-01T00:00:00.000Z', stats: { high: 1 } },
        messages: [
          {
            id: 'INBOX:12',
            uid: '12',
            folder: 'INBOX',
            threadId: '<legacy@example.com>',
            from: 'Carol <carol@example.com>',
            to: ['me@example.com'],
            subject: 'Legacy row',
            date: '2026-06-01T00:00:00.000Z',
            bodyPreview: 'legacy preview',
            bodyText: 'legacy body text',
            triage: { urgency: 'high', summary: 'Legacy triage' },
          },
        ],
      }),
      'utf8',
    );

    const first = await migrateJsonCacheIfNeeded(legacyAccount);
    assert.equal(first.migrated, true);
    assert.equal(first.messages, 1);

    const row = await getCachedMessage(legacyAccount, 'INBOX:12');
    assert.equal(row.subject, 'Legacy row');
    assert.equal(row.triage.urgency, 'high');
    assert.equal((await getSyncState(legacyAccount, 'INBOX')).highestUid, 12);
    assert.equal(
      (await searchCachedMessages(legacyAccount, { query: 'legacy' })).total,
      1,
      'migrated rows are searchable',
    );

    await assert.rejects(() => fs.access(filePath), 'the JSON cache is retired after import');
    await fs.access(`${filePath}.migrated`);

    const second = await migrateJsonCacheIfNeeded(legacyAccount);
    assert.equal(second.migrated, false, 'migration is idempotent');
  });
});

describe('deletes', () => {
  test('removing a message drops its FTS entry and thread rollup', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);
    assert.equal((await searchCachedMessages(ACCOUNT_ID, { query: 'contract' })).total, 1);

    await removeMessageFromCache(ACCOUNT_ID, 'INBOX:1');

    assert.equal((await searchCachedMessages(ACCOUNT_ID, { query: 'contract' })).total, 0);
    assert.equal((await listCachedThreads(ACCOUNT_ID, {})).total, 0);
    await assert.rejects(() => removeMessageFromCache(ACCOUNT_ID, 'INBOX:1'), /not found/i);
  });
});
