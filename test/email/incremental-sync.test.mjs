/**
 * Incremental IMAP sync — UID-range fetch, lazy bodies, flags reconcile (MIN-351).
 *
 * Run with --experimental-test-module-mocks (see test/run-all.mjs).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

const ACCOUNT_ID = 'acct-incremental-sync';

const ACCOUNT = {
  id: ACCOUNT_ID,
  username: 'me@example.com',
  address: 'me@example.com',
  folders: ['INBOX'],
  imap: { host: 'imap.example.com', port: 993, tls: true },
};

let tempHome;
let savedHome;

/** Records every mailbox borrow so we can assert on connection reuse. */
const borrows = [];

/** Mutable fake server state, reset per test. */
let server;

function makeServer() {
  return {
    uidValidity: '100',
    highestModseq: '50',
    /** @type {Map<number, { flags: string[], headers: string, parts: Record<string, string>, structure: object }>} */
    messages: new Map(),
    fetchCalls: [],
  };
}

function headerBlock({ subject, from, messageId, date, to = 'me@example.com' }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    `Date: ${date}`,
    '',
    '',
  ].join('\r\n');
}

function seed(uid, overrides = {}) {
  server.messages.set(uid, {
    flags: overrides.flags ?? [],
    headers: headerBlock({
      subject: overrides.subject ?? `Message ${uid}`,
      from: overrides.from ?? 'Alice <alice@example.com>',
      messageId: overrides.messageId ?? `<msg-${uid}@example.com>`,
      date: overrides.date ?? 'Wed, 01 Jul 2026 10:00:00 +0000',
    }),
    parts: overrides.parts ?? { 1: `Body text for message ${uid}.` },
    structure: overrides.structure ?? { type: 'text/plain', part: '1', size: 40 },
    source: overrides.source,
  });
}

/** Parse an imapflow UID range string against the seeded uids. */
function resolveRange(range) {
  const uids = [...server.messages.keys()].sort((a, b) => a - b);
  const out = new Set();
  for (const chunk of String(range).split(',')) {
    const [lo, hi] = chunk.split(':');
    if (hi === '*') {
      const from = Number(lo);
      for (const uid of uids) if (uid >= from) out.add(uid);
      // imapflow/RFC: `N:*` always yields at least the highest existing UID.
      if (uids.length) out.add(uids[uids.length - 1]);
    } else if (hi !== undefined) {
      for (const uid of uids) if (uid >= Number(lo) && uid <= Number(hi)) out.add(uid);
    } else if (server.messages.has(Number(lo))) {
      out.add(Number(lo));
    }
  }
  return [...out].sort((a, b) => a - b);
}

const fakeClient = {
  get mailbox() {
    return {
      uidValidity: server.uidValidity,
      highestModseq: server.highestModseq,
      exists: server.messages.size,
    };
  },
  enabled: new Set(),
  async search() {
    return [...server.messages.keys()];
  },
  async *fetch(range, query) {
    server.fetchCalls.push({ range, query });
    for (const uid of resolveRange(range)) {
      const entry = server.messages.get(uid);
      const row = { uid, flags: new Set(entry.flags) };
      if (query.bodyStructure) row.bodyStructure = entry.structure;
      if (query.headers) row.headers = Buffer.from(entry.headers);
      yield row;
    }
  },
  async fetchOne(uid, query) {
    const entry = server.messages.get(Number(uid));
    if (!entry) return null;
    if (query.source) {
      return { uid: Number(uid), source: Buffer.from(entry.source ?? '') };
    }
    const bodyParts = new Map();
    for (const part of query.bodyParts ?? []) {
      if (entry.parts[part] !== undefined) {
        bodyParts.set(part, Buffer.from(entry.parts[part]));
      }
    }
    return { uid: Number(uid), bodyParts };
  },
};

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-inc-sync-'));
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
      withMailbox: async (accountId, folder, fn) => {
        borrows.push({ accountId, folder });
        return fn(fakeClient, ACCOUNT);
      },
      listFoldersCached: async () => [
        { path: 'INBOX', name: 'INBOX', specialUse: null },
        { path: 'Archive', name: 'Archive', specialUse: '\\Archive' },
      ],
      startIdleWatcher: async () => ({ started: true }),
      stopIdleWatcher: async () => ({ stopped: true }),
      stopAllIdleWatchers: async () => {},
      closeAllImapSessions: async () => {},
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
  server = makeServer();
  borrows.length = 0;
});

// ── bodyStructure helpers ────────────────────────────────────────────────────

describe('bodyStructure helpers', () => {
  test('pickPreviewPart prefers text/plain and skips attachments', async () => {
    const { pickPreviewPart, structureHasAttachments } = await import('../../server/email/imap.js');

    const multipart = {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'text/html', part: '1', size: 900 },
        { type: 'text/plain', part: '2', size: 120 },
        { type: 'application/pdf', part: '3', size: 90_000, disposition: 'attachment' },
      ],
    };

    assert.deepEqual(pickPreviewPart(multipart), {
      part: '2',
      type: 'text/plain',
      size: 120,
      encoding: undefined,
    });
    assert.equal(structureHasAttachments(multipart), true);
  });

  test('pickPreviewPart falls back to html and skips oversized parts', async () => {
    const { pickPreviewPart, structureHasAttachments } = await import('../../server/email/imap.js');

    const htmlOnly = { type: 'multipart/alternative', childNodes: [{ type: 'text/html', part: '1', size: 400 }] };
    assert.equal(pickPreviewPart(htmlOnly).part, '1');
    assert.equal(structureHasAttachments(htmlOnly), false);

    const huge = { type: 'text/plain', part: '1', size: 5_000_000 };
    assert.equal(pickPreviewPart(huge), null, 'a giant text part is left for the lazy body fetch');
  });
});

// ── syncFolderMessages ───────────────────────────────────────────────────────

describe('syncFolderMessages', () => {
  test('cold start fills the newest page and records uidvalidity', async () => {
    const { syncFolderMessages } = await import('../../server/email/imap.js');
    const { getSyncState, getCachedMessage, countCachedMessages } = await import('../../server/email/cache.js');

    seed(1, { subject: 'First' });
    seed(2, { subject: 'Second' });

    const result = await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    assert.equal(result.synced, 2);
    assert.equal(result.uidValidityReset, false);
    assert.equal(result.backfillComplete, true);

    const state = await getSyncState(ACCOUNT_ID, 'INBOX');
    assert.equal(state.highestUid, 2);
    assert.equal(state.lowestUid, 1);
    assert.equal(state.backfillComplete, true);
    assert.equal(state.uidValidity, '100');

    const first = await getCachedMessage(ACCOUNT_ID, 'INBOX:1');
    assert.equal(first.subject, 'First');
    assert.equal(first.bodyText, 'Body text for message 1.');
    assert.equal(first.bodyHtml, undefined, 'sync stores text only — HTML loads lazily');
    assert.equal(first.bodyComplete, false);
    assert.equal(await countCachedMessages(ACCOUNT_ID, 'INBOX'), 2);
  });

  test('backfill walks the whole folder in batches', async () => {
    const { syncFolderMessages, MAX_SYNC_BATCH } = await import('../../server/email/imap.js');
    const { countCachedMessages, getSyncState } = await import('../../server/email/cache.js');

    for (let uid = 1; uid <= MAX_SYNC_BATCH + 25; uid += 1) {
      seed(uid, { subject: `Message ${uid}` });
    }

    let total = 0;
    let last;
    for (let pass = 0; pass < 20; pass += 1) {
      last = await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX', limit: MAX_SYNC_BATCH });
      total = await countCachedMessages(ACCOUNT_ID, 'INBOX');
      if (last.backfillComplete) break;
    }

    assert.equal(total, MAX_SYNC_BATCH + 25);
    assert.equal(last?.backfillComplete, true);
    const state = await getSyncState(ACCOUNT_ID, 'INBOX');
    assert.equal(state.lowestUid, 1);
    assert.equal(state.highestUid, MAX_SYNC_BATCH + 25);
  });

  test('backfill walks past UID gaps left by deleted mail without stalling', async () => {
    const { syncFolderMessages } = await import('../../server/email/imap.js');
    const { countCachedMessages, getSyncState } = await import('../../server/email/cache.js');

    // Two dense blocks with a wide gap between them (UIDs 11–99 never existed —
    // e.g. bulk-deleted). A numeric `start:end` walk stalls on the empty gap;
    // walking the real UID list must skip it.
    for (let uid = 1; uid <= 10; uid += 1) seed(uid);
    for (let uid = 100; uid <= 110; uid += 1) seed(uid);

    let last;
    let passes = 0;
    for (; passes < 30; passes += 1) {
      last = await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX', limit: 5 });
      if (last.backfillComplete) break;
    }

    assert.equal(last?.backfillComplete, true, 'backfill terminates instead of spinning on the gap');
    assert.ok(passes < 10, `walks the 21 UIDs in a handful of passes (took ${passes + 1})`);
    assert.equal(await countCachedMessages(ACCOUNT_ID, 'INBOX'), 21);
    const state = await getSyncState(ACCOUNT_ID, 'INBOX');
    assert.equal(state.lowestUid, 1);
    assert.equal(state.highestUid, 110);
  });

  test('sync decodes base64 preview parts instead of storing raw encoding', async () => {
    const { syncFolderMessages } = await import('../../server/email/imap.js');
    const { getCachedMessage } = await import('../../server/email/cache.js');

    const html = '<p>Security alert</p>';
    seed(1, {
      subject: 'Security alert',
      parts: { 1: Buffer.from(html, 'utf8').toString('base64') },
      structure: { type: 'text/html', part: '1', size: html.length, encoding: 'BASE64' },
    });

    await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    const message = await getCachedMessage(ACCOUNT_ID, 'INBOX:1');
    assert.match(message.bodyText, /Security alert/);
    assert.doesNotMatch(message.bodyPreview, /^[A-Za-z0-9+/=]{40,}$/);
  });

  test('second sync fetches only UIDs above the cursor', async () => {
    const { syncFolderMessages } = await import('../../server/email/imap.js');
    const { countCachedMessages } = await import('../../server/email/cache.js');

    seed(1);
    seed(2);
    await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    server.fetchCalls.length = 0;
    seed(3, { subject: 'Fresh' });
    const result = await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    assert.equal(result.synced, 1, 'only the new message is ingested');
    assert.equal(result.messages[0].subject, 'Fresh');
    assert.equal(await countCachedMessages(ACCOUNT_ID, 'INBOX'), 3);

    const newMailFetch = server.fetchCalls.find((call) => call.query.headers);
    assert.equal(newMailFetch.range, '3:*', 'the range starts one past the stored cursor');
  });

  test('an unchanged mailbox re-ingests nothing', async () => {
    const { syncFolderMessages } = await import('../../server/email/imap.js');

    seed(1);
    seed(2);
    await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    const result = await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });
    assert.equal(result.synced, 0, '`N:*` returns the highest uid, which must be filtered out');
    assert.equal(result.total, 2);
  });

  test('external read and delete are reflected by the reconcile pass', async () => {
    const { syncFolderMessages } = await import('../../server/email/imap.js');
    const { getCachedMessage } = await import('../../server/email/cache.js');

    seed(1);
    seed(2);
    await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });
    assert.equal((await getCachedMessage(ACCOUNT_ID, 'INBOX:1')).flags.seen, false);

    // Another mail client reads uid 1 and deletes uid 2.
    server.messages.get(1).flags = ['\\Seen'];
    server.messages.delete(2);

    const result = await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    assert.equal(result.reconciled.updated, 1);
    assert.equal(result.reconciled.removed, 1);
    assert.equal((await getCachedMessage(ACCOUNT_ID, 'INBOX:1')).flags.seen, true);
    assert.equal(await getCachedMessage(ACCOUNT_ID, 'INBOX:2'), null);
  });

  test('CONDSTORE skips the reconcile fetch when HIGHESTMODSEQ has not moved', async () => {
    const { syncFolderMessages } = await import('../../server/email/imap.js');

    fakeClient.enabled = new Set(['CONDSTORE']);
    try {
      seed(1);
      seed(2);
      await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

      server.fetchCalls.length = 0;
      const quiet = await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });
      assert.equal(quiet.reconciled.skipped, 'unchanged_modseq');
      assert.equal(
        server.fetchCalls.filter((call) => call.query.flags && !call.query.headers).length,
        0,
        'no FLAGS fetch is issued for an unchanged mailbox',
      );

      // A flag change on the server bumps modseq, so the next pass reconciles.
      server.highestModseq = '51';
      server.messages.get(1).flags = ['\\Seen'];
      const busy = await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });
      assert.equal(busy.reconciled.updated, 1);
    } finally {
      fakeClient.enabled = new Set();
    }
  });

  test('a uidvalidity change clears the folder and refills it', async () => {
    const { syncFolderMessages } = await import('../../server/email/imap.js');
    const { getCachedMessage, getSyncState } = await import('../../server/email/cache.js');

    seed(1, { subject: 'Old world' });
    await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    server = makeServer();
    server.uidValidity = '999';
    seed(1, { subject: 'New world', messageId: '<new-1@example.com>' });

    const result = await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    assert.equal(result.uidValidityReset, true);
    assert.equal((await getCachedMessage(ACCOUNT_ID, 'INBOX:1')).subject, 'New world');
    assert.equal((await getSyncState(ACCOUNT_ID, 'INBOX')).uidValidity, '999');
  });
});

// ── ensureMessageBody ────────────────────────────────────────────────────────

describe('ensureMessageBody', () => {
  test('downloads the full source once and caches html + attachments', async () => {
    const { syncFolderMessages, ensureMessageBody } = await import('../../server/email/imap.js');

    seed(1, {
      source: [
        'From: Alice <alice@example.com>',
        'To: me@example.com',
        'Subject: Message 1',
        'Message-ID: <msg-1@example.com>',
        'Date: Wed, 01 Jul 2026 10:00:00 +0000',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Full <b>html</b> body.</p>',
      ].join('\r\n'),
    });

    await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    const loaded = await ensureMessageBody(ACCOUNT_ID, 'INBOX:1');
    assert.equal(loaded.cached, false);
    assert.equal(loaded.bodyComplete, true);
    assert.match(loaded.bodyHtml, /<b>html<\/b>/);
    assert.match(loaded.bodyText, /Full/);

    const again = await ensureMessageBody(ACCOUNT_ID, 'INBOX:1');
    assert.equal(again.cached, true, 'a second open is served from the store');
  });
});

// ── connection reuse ─────────────────────────────────────────────────────────

describe('connection reuse', () => {
  test('a bulk flag action opens one mailbox borrow per folder', async () => {
    const { syncFolderMessages } = await import('../../server/email/imap.js');
    const { bulkMessageAction } = await import('../../server/email/mail-actions.js');

    for (let uid = 1; uid <= 10; uid += 1) seed(uid);
    await syncFolderMessages(ACCOUNT_ID, { folder: 'INBOX' });

    // messageFlagsAdd is only exercised through the pool in this test.
    const stores = [];
    fakeClient.messageFlagsAdd = async (uidSet, flags) => {
      stores.push({ uidSet, flags });
      return true;
    };

    borrows.length = 0;
    const ids = Array.from({ length: 10 }, (_, index) => `INBOX:${index + 1}`);
    const result = await bulkMessageAction(ACCOUNT_ID, { ids, action: 'read' });

    assert.equal(result.ok, true);
    assert.equal(result.results.length, 10);
    assert.equal(borrows.length, 1, 'ten messages, one mailbox borrow');
    assert.equal(stores.length, 1, 'one STORE with a UID set, not ten');
    assert.equal(stores[0].uidSet, '1,2,3,4,5,6,7,8,9,10');

    delete fakeClient.messageFlagsAdd;
  });
});
