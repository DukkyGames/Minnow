/**
 * Phase 4 AI layer — store-backed behavior: review queue, follow-ups,
 * sender overrides (MIN-355). No network, no LLM: everything below the
 * classification layer.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { closeMailDbs, getMailDb } from '../../server/email/store.js';
import {
  AUTO_ALLOWABLE_ACTIONS,
  dismissPendingAction,
  enqueuePendingAction,
  listAutoAllowRules,
  listPendingActions,
  setAutoAllowRule,
} from '../../server/email/pending-actions.js';
import {
  dismissFollowup,
  listFollowups,
  satisfyFollowupsForMessage,
  sweepOverdueFollowups,
} from '../../server/email/followups.js';
import {
  listSenderOverrides,
  loadSenderSignals,
  setSenderOverride,
} from '../../server/email/priority.js';
import { listUnackedNotifications } from '../../server/scheduler/delivery.js';

const ACCOUNT_ID = 'acct-phase4-test';

let tempHome;
let savedHome;

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-phase4-'));
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

beforeEach(() => {
  const db = getMailDb(ACCOUNT_ID);
  db.exec('DELETE FROM pending_actions; DELETE FROM followups; DELETE FROM sender_overrides;');
  db.exec("DELETE FROM meta WHERE key = 'pending_auto_allow'");
});

function insertFollowup(overrides = {}) {
  const db = getMailDb(ACCOUNT_ID);
  const row = {
    id: overrides.id ?? `fu-${Math.random().toString(36).slice(2)}`,
    thread_id: overrides.thread_id ?? '<thread-a@example.com>',
    message_id: overrides.message_id ?? '',
    to_addr: overrides.to_addr ?? 'Femi <femi@example.com>',
    subject: overrides.subject ?? 'Contract signature',
    sent_at: overrides.sent_at ?? new Date(Date.now() - 4 * 86_400_000).toISOString(),
    expected_by: overrides.expected_by ?? new Date(Date.now() + 86_400_000).toISOString(),
    state: overrides.state ?? 'waiting',
    notified: overrides.notified ?? 0,
    satisfied_at: '',
    satisfied_by: '',
  };
  db.prepare(
    `INSERT INTO followups (id, thread_id, message_id, to_addr, subject, sent_at,
       expected_by, state, notified, satisfied_at, satisfied_by)
     VALUES (@id, @thread_id, @message_id, @to_addr, @subject, @sent_at,
       @expected_by, @state, @notified, @satisfied_at, @satisfied_by)`,
  ).run(row);
  return row;
}

describe('pending-actions review queue', () => {
  test('enqueue stores a pending row and list returns it', async () => {
    const pending = await enqueuePendingAction(ACCOUNT_ID, {
      source: 'digest',
      label: 'Archive 2 newsletters',
      action: 'archive',
      messageIds: ['INBOX:1', 'INBOX:2'],
      threadIds: ['t-1'],
    });
    assert.equal(pending.state, 'pending');

    const listed = await listPendingActions(ACCOUNT_ID);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].label, 'Archive 2 newsletters');
    assert.deepEqual(listed[0].messageIds, ['INBOX:1', 'INBOX:2']);
  });

  test('rejects unsupported actions, empty batches, and move without folder', async () => {
    await assert.rejects(
      enqueuePendingAction(ACCOUNT_ID, {
        source: 'digest',
        action: 'forward',
        messageIds: ['INBOX:1'],
      }),
      /Unsupported/,
    );
    await assert.rejects(
      enqueuePendingAction(ACCOUNT_ID, { source: 'digest', action: 'archive', messageIds: [] }),
      /messageIds/,
    );
    await assert.rejects(
      enqueuePendingAction(ACCOUNT_ID, {
        source: 'digest',
        action: 'move',
        messageIds: ['INBOX:1'],
      }),
      /destFolder/,
    );
  });

  test('dismiss resolves the row and it leaves the pending list', async () => {
    const pending = await enqueuePendingAction(ACCOUNT_ID, {
      source: 'chat_agent',
      action: 'read',
      messageIds: ['INBOX:1'],
    });
    const dismissed = await dismissPendingAction(ACCOUNT_ID, pending.id);
    assert.equal(dismissed.state, 'dismissed');
    assert.equal((await listPendingActions(ACCOUNT_ID)).length, 0);
    await assert.rejects(dismissPendingAction(ACCOUNT_ID, pending.id), /already/);
  });

  test('always-allow rules persist per source:action and never cover delete', async () => {
    await setAutoAllowRule(ACCOUNT_ID, { source: 'digest', action: 'archive', allow: true });
    assert.deepEqual(await listAutoAllowRules(ACCOUNT_ID), ['digest:archive']);

    await setAutoAllowRule(ACCOUNT_ID, { source: 'digest', action: 'archive', allow: false });
    assert.deepEqual(await listAutoAllowRules(ACCOUNT_ID), []);

    await assert.rejects(
      setAutoAllowRule(ACCOUNT_ID, { source: 'digest', action: 'delete', allow: true }),
      /cannot be auto-allowed/,
    );
    assert.ok(!AUTO_ALLOWABLE_ACTIONS.includes('delete'));
  });
});

describe('follow-up tracking', () => {
  test('an inbound reply in the same thread satisfies the follow-up', async () => {
    const row = insertFollowup();
    const satisfied = await satisfyFollowupsForMessage(ACCOUNT_ID, {
      id: 'INBOX:9',
      threadId: '<thread-a@example.com>',
      from: 'Someone Else <other@example.com>',
      subject: 'Re: Something unrelated',
    });
    assert.equal(satisfied, 1);
    const remaining = await listFollowups(ACCOUNT_ID, { state: 'waiting' });
    assert.equal(remaining.length, 0);
    const done = await listFollowups(ACCOUNT_ID, { state: 'satisfied' });
    assert.equal(done[0].id, row.id);
    assert.equal(done[0].satisfiedBy, 'INBOX:9');
  });

  test('sender + normalized subject satisfies when the thread was never cached', async () => {
    insertFollowup({ thread_id: '' });
    const satisfied = await satisfyFollowupsForMessage(ACCOUNT_ID, {
      id: 'INBOX:10',
      threadId: '<brand-new@example.com>',
      from: 'Femi <femi@example.com>',
      subject: 'Re: Contract signature',
    });
    assert.equal(satisfied, 1);
  });

  test('a different sender on the same subject does not satisfy', async () => {
    insertFollowup({ thread_id: '' });
    const satisfied = await satisfyFollowupsForMessage(ACCOUNT_ID, {
      id: 'INBOX:11',
      threadId: '',
      from: 'Impostor <impostor@example.com>',
      subject: 'Re: Contract signature',
    });
    assert.equal(satisfied, 0);
  });

  test('overdue sweep notifies once and only once', async () => {
    insertFollowup({
      id: 'fu-overdue',
      expected_by: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const first = await sweepOverdueFollowups(ACCOUNT_ID);
    assert.equal(first, 1);
    const second = await sweepOverdueFollowups(ACCOUNT_ID);
    assert.equal(second, 0, 'notified rows are not re-notified');

    const notifications = await listUnackedNotifications();
    const mine = notifications.filter((row) => row.jobId === 'email-followup:fu-overdue');
    assert.equal(mine.length, 1);
    assert.match(mine[0].message, /No reply yet from/);
  });

  test('dismiss stops the wait', async () => {
    const row = insertFollowup();
    const dismissed = await dismissFollowup(ACCOUNT_ID, row.id);
    assert.equal(dismissed.state, 'dismissed');
    assert.equal((await listFollowups(ACCOUNT_ID, { state: 'waiting' })).length, 0);
  });
});

describe('sender overrides + signals', () => {
  test('set, list, and clear an override', async () => {
    await setSenderOverride(ACCOUNT_ID, 'Boss <Boss@Corp.com>', 'high');
    await setSenderOverride(ACCOUNT_ID, '@noise.io', 'low');

    const overrides = await listSenderOverrides(ACCOUNT_ID);
    assert.deepEqual(
      overrides.map((row) => `${row.sender}=${row.level}`).sort(),
      ['@noise.io=low', 'boss@corp.com=high'],
    );

    await setSenderOverride(ACCOUNT_ID, 'boss@corp.com', '');
    assert.equal((await listSenderOverrides(ACCOUNT_ID)).length, 1);
  });

  test('loadSenderSignals resolves exact and domain overrides per header', async () => {
    await setSenderOverride(ACCOUNT_ID, '@noise.io', 'low');
    const signals = await loadSenderSignals(ACCOUNT_ID, [
      'Newsletter <blast@noise.io>',
      'Human <human@real.org>',
    ]);
    assert.equal(signals.get('Newsletter <blast@noise.io>').override, 'low');
    assert.equal(signals.get('Human <human@real.org>').override, '');
  });

  test('invalid override input is refused', async () => {
    await assert.rejects(setSenderOverride(ACCOUNT_ID, 'nonsense', 'high'), /email address/);
    await assert.rejects(setSenderOverride(ACCOUNT_ID, 'a@b.com', 'urgent'), /level/);
  });
});
