/**
 * Draft persistence and the IMAP Drafts mirror (MIN-353).
 *
 * Run with --experimental-test-module-mocks (see test/run-all.mjs).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

const ACCOUNT_ID = 'acct-drafts';

const ACCOUNT = {
  id: ACCOUNT_ID,
  username: 'me@example.com',
  fromAddress: 'Me <me@example.com>',
  folders: ['INBOX'],
  imap: { host: 'imap.example.com', port: 993, tls: true },
};

let tempHome;
let savedHome;
let folderList;
let appends;
let deletes;
let nextUid;

const fakeClient = {
  async append(folderPath, raw, flags) {
    appends.push({ folder: folderPath, raw, flags });
    return { uid: nextUid++ };
  },
  async messageFlagsAdd(uid, flags) {
    deletes.push({ uid, flags });
  },
  async messageDelete(uid) {
    deletes.push({ uid, expunged: true });
  },
};

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-drafts-'));
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
  const { getMailDb } = await import('../../server/email/store.js');
  getMailDb(ACCOUNT_ID).exec('DELETE FROM drafts');
  appends = [];
  deletes = [];
  nextUid = 10;
  folderList = [
    { path: 'INBOX', name: 'INBOX', specialUse: null },
    { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts' },
  ];
});

describe('draft persistence', () => {
  test('saves a partial draft and reads it back', async () => {
    const { saveDraft, getDraft } = await import('../../server/email/drafts.js');

    const draft = await saveDraft(ACCOUNT_ID, {
      to: 'b@example.com',
      subject: 'Half a thought',
      body: 'I was going to say',
    });

    assert.ok(draft.id, 'an id is minted for a new draft');
    const reloaded = await getDraft(ACCOUNT_ID, draft.id);
    assert.equal(reloaded.subject, 'Half a thought');
    assert.equal(reloaded.body, 'I was going to say');
    assert.equal(reloaded.to, 'b@example.com');
  });

  test('accepts an entirely empty draft — a draft is incomplete by definition', async () => {
    const { saveDraft } = await import('../../server/email/drafts.js');
    const draft = await saveDraft(ACCOUNT_ID, {});
    assert.ok(draft.id);
    assert.equal(draft.subject, '');
    assert.equal(draft.body, '');
  });

  test('autosaving the same id updates in place rather than piling up rows', async () => {
    const { saveDraft, listDrafts } = await import('../../server/email/drafts.js');

    const first = await saveDraft(ACCOUNT_ID, { body: 'v1' });
    await saveDraft(ACCOUNT_ID, { id: first.id, body: 'v2' });
    await saveDraft(ACCOUNT_ID, { id: first.id, body: 'v3' });

    const drafts = await listDrafts(ACCOUNT_ID);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].body, 'v3');
    assert.equal(drafts[0].createdAt, first.createdAt, 'creation time is preserved');
  });

  test('stores attachment metadata but not the bytes', async () => {
    const { saveDraft } = await import('../../server/email/drafts.js');

    const draft = await saveDraft(ACCOUNT_ID, {
      attachments: [
        { filename: 'deck.pdf', contentType: 'application/pdf', size: 900, content: 'QUJD' },
      ],
    });

    assert.equal(draft.attachments.length, 1);
    assert.equal(draft.attachments[0].filename, 'deck.pdf');
    assert.equal(draft.attachments[0].size, 900);
    assert.equal(draft.attachments[0].content, undefined, 'bytes are never persisted');
  });

  test('lists drafts for one thread, newest first', async () => {
    const { saveDraft, listDrafts } = await import('../../server/email/drafts.js');

    await saveDraft(ACCOUNT_ID, { threadId: '<t1@x>', body: 'one' });
    await saveDraft(ACCOUNT_ID, { threadId: '<t2@x>', body: 'two' });

    const scoped = await listDrafts(ACCOUNT_ID, { threadId: '<t1@x>' });
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].body, 'one');
    assert.equal((await listDrafts(ACCOUNT_ID)).length, 2);
  });

  test('deletes a draft and reports whether anything went', async () => {
    const { saveDraft, deleteDraft, getDraft } = await import('../../server/email/drafts.js');

    const draft = await saveDraft(ACCOUNT_ID, { body: 'temporary' });
    assert.deepEqual(await deleteDraft(ACCOUNT_ID, draft.id), { deleted: true });
    assert.equal(await getDraft(ACCOUNT_ID, draft.id), null);
    assert.deepEqual(await deleteDraft(ACCOUNT_ID, draft.id), { deleted: false });
  });

  test('a draft survives closing the database', async () => {
    const { saveDraft, getDraft } = await import('../../server/email/drafts.js');
    const { closeMailDb } = await import('../../server/email/store.js');

    const draft = await saveDraft(ACCOUNT_ID, { body: 'must outlive a restart' });
    closeMailDb(ACCOUNT_ID);

    const reloaded = await getDraft(ACCOUNT_ID, draft.id);
    assert.equal(reloaded.body, 'must outlive a restart');
  });
});

describe('IMAP Drafts mirror', () => {
  test('appends with the \\Draft flag', async () => {
    const { saveDraft, syncDraftToImap } = await import('../../server/email/drafts.js');

    const draft = await saveDraft(ACCOUNT_ID, {
      to: 'b@example.com',
      subject: 'Mirrored',
      body: 'text',
    });
    const result = await syncDraftToImap(ACCOUNT_ID, draft.id);

    assert.equal(result.synced, true);
    assert.equal(result.folder, 'Drafts');
    assert.equal(appends.length, 1);
    assert.ok(appends[0].flags.includes('\\Draft'));
    assert.match(appends[0].raw.toString(), /Subject: Mirrored/);
  });

  test('expunges the previous copy so the folder does not fill up', async () => {
    const { saveDraft, syncDraftToImap, getDraft } = await import('../../server/email/drafts.js');

    const draft = await saveDraft(ACCOUNT_ID, { subject: 'v1', body: 'one' });
    await syncDraftToImap(ACCOUNT_ID, draft.id);
    const afterFirst = await getDraft(ACCOUNT_ID, draft.id);
    assert.equal(afterFirst.imapUid, '10');

    await saveDraft(ACCOUNT_ID, { id: draft.id, subject: 'v2', body: 'two' });
    await syncDraftToImap(ACCOUNT_ID, draft.id);

    assert.equal(appends.length, 2);
    assert.ok(
      deletes.some((row) => Number(row.uid) === 10),
      'the superseded uid is expunged',
    );
    assert.equal((await getDraft(ACCOUNT_ID, draft.id)).imapUid, '11');
  });

  test('a mirror failure never costs the local draft', async () => {
    const { saveDraft, syncDraftToImap, getDraft } = await import('../../server/email/drafts.js');
    const failing = mock.method(fakeClient, 'append', async () => {
      throw new Error('NO [OVERQUOTA]');
    });

    const draft = await saveDraft(ACCOUNT_ID, { body: 'precious words' });
    const result = await syncDraftToImap(ACCOUNT_ID, draft.id);

    assert.equal(result.synced, false);
    assert.match(result.error, /OVERQUOTA/);
    assert.equal(
      (await getDraft(ACCOUNT_ID, draft.id)).body,
      'precious words',
      'the local row is untouched by a failed mirror',
    );
    failing.mock.restore();
  });

  test('reports when the account has no Drafts folder', async () => {
    const { saveDraft, syncDraftToImap } = await import('../../server/email/drafts.js');
    folderList = [{ path: 'INBOX', name: 'INBOX', specialUse: null }];

    const draft = await saveDraft(ACCOUNT_ID, { body: 'nowhere to go' });
    const result = await syncDraftToImap(ACCOUNT_ID, draft.id);

    assert.deepEqual(result, { synced: false, reason: 'no_drafts_folder' });
    assert.equal(appends.length, 0);
  });

  test('rejects an unknown draft id', async () => {
    const { syncDraftToImap } = await import('../../server/email/drafts.js');
    await assert.rejects(() => syncDraftToImap(ACCOUNT_ID, 'nope'), /Draft not found/);
  });
});
