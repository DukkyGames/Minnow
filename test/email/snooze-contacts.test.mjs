/**
 * Snooze, contact harvesting/autocomplete, and send-later (MIN-353).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  clearDueSnoozes,
  listCachedMessages,
  listCachedThreads,
  listDueSnoozes,
  mergeMessagesIntoCache,
  setMessageSnooze,
  writeMessageCache,
} from '../../server/email/cache.js';
import { recordSentRecipients, searchContacts, splitAddressHeader } from '../../server/email/contacts.js';
import { closeMailDbs } from '../../server/email/store.js';

const ACCOUNT_ID = 'acct-snooze-contacts';

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
    bodyPreview: 'Please review',
    flags: { seen: false, flagged: false, answered: false },
    ...overrides,
  };
}

/** An ISO timestamp `minutes` from now. */
function fromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-snooze-'));
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
  const { getMailDb } = await import('../../server/email/store.js');
  getMailDb(ACCOUNT_ID).exec('DELETE FROM contacts');
});

describe('snooze', () => {
  test('hides a snoozed message from the list and the thread rollup', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);
    assert.equal((await listCachedMessages(ACCOUNT_ID)).messages.length, 1);

    await setMessageSnooze(ACCOUNT_ID, 'INBOX:1', fromNow(60));

    assert.equal((await listCachedMessages(ACCOUNT_ID)).messages.length, 0);
    assert.equal((await listCachedThreads(ACCOUNT_ID)).threads.length, 0);
  });

  test('keeps a conversation visible while any message in it is awake', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [
        message({ uid: '1', messageId: '<a@x>' }),
        message({ uid: '2', messageId: '<b@x>', date: '2026-07-02T10:00:00.000Z' }),
      ],
      'INBOX',
      2,
    );

    await setMessageSnooze(ACCOUNT_ID, 'INBOX:1', fromNow(60));

    assert.equal(
      (await listCachedThreads(ACCOUNT_ID)).threads.length,
      1,
      'snoozing one reply must not hide the exchange',
    );
  });

  test('the snoozed filter shows exactly what the default view hides', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);
    await setMessageSnooze(ACCOUNT_ID, 'INBOX:1', fromNow(60));

    const snoozed = await listCachedMessages(ACCOUNT_ID, { filter: 'snoozed' });
    assert.equal(snoozed.messages.length, 1);
    assert.equal(snoozed.messages[0].id, 'INBOX:1');
  });

  test('un-snoozes with an empty until', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);
    await setMessageSnooze(ACCOUNT_ID, 'INBOX:1', fromNow(60));
    await setMessageSnooze(ACCOUNT_ID, 'INBOX:1', '');

    assert.equal((await listCachedMessages(ACCOUNT_ID)).messages.length, 1);
  });

  test('refuses a past or malformed wake time', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);

    await assert.rejects(
      () => setMessageSnooze(ACCOUNT_ID, 'INBOX:1', fromNow(-60)),
      /must be in the future/,
    );
    await assert.rejects(
      () => setMessageSnooze(ACCOUNT_ID, 'INBOX:1', 'not-a-date'),
      /valid ISO timestamp/,
    );
  });

  test('a due snooze is reported and then cleared', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);
    await setMessageSnooze(ACCOUNT_ID, 'INBOX:1', fromNow(1));

    // Nothing is due yet.
    assert.equal((await listDueSnoozes(ACCOUNT_ID)).length, 0);

    // Ask as of a moment after the wake time rather than sleeping for it.
    const later = fromNow(5);
    const due = await listDueSnoozes(ACCOUNT_ID, later);
    assert.equal(due.length, 1);
    assert.equal(due[0].id, 'INBOX:1');

    assert.deepEqual(await clearDueSnoozes(ACCOUNT_ID, later), { woken: 1 });
    assert.equal(
      (await listCachedMessages(ACCOUNT_ID)).messages.length,
      1,
      'the message is back in the ordinary list',
    );
  });

  test('a message whose snooze has elapsed reappears without a sweep', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);
    // Write a past timestamp directly: setMessageSnooze rightly refuses one.
    const { getMailDb } = await import('../../server/email/store.js');
    getMailDb(ACCOUNT_ID)
      .prepare("UPDATE messages SET snooze_until = ? WHERE id = 'INBOX:1'")
      .run(fromNow(-5));

    assert.equal(
      (await listCachedMessages(ACCOUNT_ID)).messages.length,
      1,
      'the list must not depend on the poller having run',
    );
  });
});

describe('contact harvesting', () => {
  test('splits a Name <addr> header', () => {
    assert.deepEqual(splitAddressHeader('Alice Smith <Alice@Example.com>'), {
      name: 'Alice Smith',
      address: 'alice@example.com',
    });
    assert.deepEqual(splitAddressHeader('bob@example.com'), {
      name: '',
      address: 'bob@example.com',
    });
    assert.deepEqual(splitAddressHeader('"Quoted Name" <q@example.com>'), {
      name: 'Quoted Name',
      address: 'q@example.com',
    });
  });

  test('learns senders and recipients from synced mail', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);

    const contacts = await searchContacts(ACCOUNT_ID, { query: 'alice' });
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].address, 'alice@example.com');
    assert.equal(contacts[0].name, 'Alice');
    assert.equal(contacts[0].header, 'Alice <alice@example.com>');
  });

  test('ignores header values that are not addresses', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [message({ from: 'undisclosed recipients', to: [''] })],
      'INBOX',
      1,
    );
    assert.equal((await searchContacts(ACCOUNT_ID)).length, 0);
  });

  test('ranks people you have written to above people who wrote to you', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [
        message({ uid: '1', from: 'Loud Newsletter <news@example.com>', messageId: '<n1@x>' }),
        message({ uid: '2', from: 'Loud Newsletter <news@example.com>', messageId: '<n2@x>' }),
        message({ uid: '3', from: 'Loud Newsletter <news@example.com>', messageId: '<n3@x>' }),
        message({ uid: '4', from: 'Real Person <real@example.com>', messageId: '<r1@x>' }),
      ],
      'INBOX',
      4,
    );
    await recordSentRecipients(ACCOUNT_ID, ['Real Person <real@example.com>']);

    const contacts = await searchContacts(ACCOUNT_ID, { query: 'example.com' });
    assert.equal(
      contacts[0].address,
      'real@example.com',
      'one reply outweighs three newsletters',
    );
  });

  test('records every recipient of a sent message, across to/cc/bcc', async () => {
    await recordSentRecipients(ACCOUNT_ID, [
      'a@example.com, b@example.com',
      'c@example.com',
      'd@example.com',
    ]);

    const contacts = await searchContacts(ACCOUNT_ID, { limit: 50 });
    assert.deepEqual(
      contacts.map((row) => row.address).sort(),
      ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'],
    );
  });

  test('a wildcard in the query is matched literally', async () => {
    await mergeMessagesIntoCache(ACCOUNT_ID, [message()], 'INBOX', 1);
    assert.equal(
      (await searchContacts(ACCOUNT_ID, { query: '%' })).length,
      0,
      'a percent sign must not match every contact',
    );
  });

  test('keeps the first real name rather than blanking it later', async () => {
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [message({ uid: '1', from: 'Alice Smith <alice@example.com>', messageId: '<n1@x>' })],
      'INBOX',
      1,
    );
    await mergeMessagesIntoCache(
      ACCOUNT_ID,
      [message({ uid: '2', from: 'alice@example.com', messageId: '<n2@x>' })],
      'INBOX',
      2,
    );

    const [contact] = await searchContacts(ACCOUNT_ID, { query: 'alice' });
    assert.equal(contact.name, 'Alice Smith');
  });
});
