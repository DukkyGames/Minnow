/**
 * Needs-attention dismissals — filter highlights and persist user clears.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { buildInboxSummary } from '../../server/email/agent.js';
import {
  dismissAttentionHighlight,
  loadDismissedMessageIds,
} from '../../server/email/attention.js';
import { updateMessageTriage } from '../../server/email/cache.js';
import { closeMailDbs, getMailDb } from '../../server/email/store.js';

const ACCOUNT_ID = 'attention-test';

let tempHome;
let savedHome;

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-attention-'));
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

function insertMessage(row) {
  const db = getMailDb(ACCOUNT_ID);
  db.prepare(
    `INSERT INTO messages (
       id, folder, uid, thread_id, from_addr, subject, date, date_ms, body_preview, seen
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.folder ?? 'INBOX',
    row.uid,
    row.threadId,
    row.from,
    row.subject,
    row.date,
    Date.parse(row.date),
    row.bodyPreview ?? '',
    row.seen ? 1 : 0,
  );
}

beforeEach(async () => {
  const db = getMailDb(ACCOUNT_ID);
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM attention_dismissals');

  insertMessage({
    id: 'INBOX:1',
    uid: '1',
    threadId: 'thread-a',
    from: 'alerts@example.com',
    subject: 'Security alert',
    date: '2026-07-22T10:00:00.000Z',
    bodyPreview: 'Check your account',
    seen: false,
  });
  insertMessage({
    id: 'INBOX:2',
    uid: '2',
    threadId: 'thread-b',
    from: 'team@example.com',
    subject: 'Review needed',
    date: '2026-07-22T09:00:00.000Z',
    bodyPreview: 'Please review the doc',
    seen: true,
  });

  await updateMessageTriage(ACCOUNT_ID, 'INBOX:1', {
    summary: 'Security alert for your account',
    tags: ['security'],
    urgency: 'high',
    category: 'security',
    cachedAt: '2026-07-22T10:01:00.000Z',
  });
  await updateMessageTriage(ACCOUNT_ID, 'INBOX:2', {
    summary: 'Doc review requested',
    tags: ['work'],
    urgency: 'normal',
    category: 'needs_reply',
    cachedAt: '2026-07-22T09:01:00.000Z',
  });
});

describe('attention dismissals', () => {
  test('dismissed message ids are excluded from inbox highlights', async () => {
    const before = await buildInboxSummary(ACCOUNT_ID);
    assert.equal(before.highlights.length, 2);

    await dismissAttentionHighlight(ACCOUNT_ID, 'INBOX:1');
    assert.equal(loadDismissedMessageIds(ACCOUNT_ID).has('INBOX:1'), true);

    const after = await buildInboxSummary(ACCOUNT_ID);
    assert.equal(after.highlights.length, 1);
    assert.equal(after.highlights[0].messageId, 'INBOX:2');
  });

  test('attention_dismissals table is created on fresh mail db', () => {
    const db = getMailDb('schema-check');
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='attention_dismissals'",
      )
      .get();
    assert.ok(row);
  });
});
