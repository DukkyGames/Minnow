/**
 * Phase 5 Automations v2 (MIN-356) — store-backed behavior with no network
 * and no LLM: rule normalization, condition matching, dry-run, the audit log,
 * and the action router's routing decisions (review queue vs direct, forward
 * always drafts, os_notify reaches the scheduler queue).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { closeMailDbs, getMailDb } from '../../server/email/store.js';
import {
  createAutomation,
  deleteAutomationsForAccount,
  dryRunAutomation,
  evaluateAutomationsForMessage,
  listAutomationRuns,
  matchCondition,
  matchesConditions,
  normalizeRule,
  recordAutomationRun,
  triggerMatches,
} from '../../server/email/automations.js';
import { listPendingActions } from '../../server/email/pending-actions.js';
import { listUnackedNotifications } from '../../server/scheduler/delivery.js';

const ACCOUNT_ID = 'acct-phase5-test';

let tempHome;
let savedHome;

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-phase5-'));
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
  const db = getMailDb(ACCOUNT_ID);
  db.exec('DELETE FROM messages; DELETE FROM automation_runs; DELETE FROM pending_actions; DELETE FROM drafts;');
  await deleteAutomationsForAccount(ACCOUNT_ID);
});

function insertMessage(overrides = {}) {
  const db = getMailDb(ACCOUNT_ID);
  const row = {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    folder: overrides.folder ?? 'INBOX',
    uid: overrides.uid ?? String(Math.floor(Math.random() * 1e9)),
    thread_id: overrides.thread_id ?? '',
    from_addr: overrides.from_addr ?? 'Ada <ada@example.com>',
    subject: overrides.subject ?? 'Hello there',
    date: overrides.date ?? new Date().toISOString(),
    date_ms: overrides.date_ms ?? Date.now(),
    has_attachments: overrides.has_attachments ?? 0,
    triage_json: overrides.triage_json ?? null,
  };
  db.prepare(
    `INSERT INTO messages (id, folder, uid, thread_id, from_addr, subject, date, date_ms, has_attachments, triage_json)
     VALUES (@id, @folder, @uid, @thread_id, @from_addr, @subject, @date, @date_ms, @has_attachments, @triage_json)`,
  ).run(row);
  return row;
}

// ── normalizeRule ────────────────────────────────────────────────────────────

describe('normalizeRule', () => {
  test('migrates a v1 single-action rule to the v2 shape', () => {
    const rule = normalizeRule({
      id: 'r1',
      name: 'Legacy',
      accountId: ACCOUNT_ID,
      trigger: 'on_new_message',
      action: 'triage',
      config: { tag: 'x' },
    });
    assert.deepEqual(rule.actions, [{ type: 'triage' }]);
    assert.deepEqual(rule.conditions, []);
    assert.equal(rule.trusted, false);
  });

  test('maps legacy notify to os_notify and carries its config', () => {
    const rule = normalizeRule({
      id: 'r2',
      name: 'Ping',
      accountId: ACCOUNT_ID,
      action: 'notify',
      config: { title: 'Hi', body: 'Body' },
    });
    assert.equal(rule.actions[0].type, 'os_notify');
    assert.equal(rule.actions[0].title, 'Hi');
    assert.equal(rule.actions[0].body, 'Body');
  });

  test('drops unknown conditions and actions', () => {
    const rule = normalizeRule({
      id: 'r3',
      name: 'Mixed',
      accountId: ACCOUNT_ID,
      conditions: [
        { field: 'sender', op: 'contains', value: 'a' },
        { field: 'bogus', op: 'contains', value: 'x' },
        { field: 'subject', op: 'nope', value: 'y' },
      ],
      actions: [{ type: 'archive' }, { type: 'delete' }, { type: 'nonsense' }],
    });
    assert.equal(rule.conditions.length, 1);
    assert.equal(rule.conditions[0].field, 'sender');
    assert.deepEqual(rule.actions, [{ type: 'archive' }]);
  });
});

// ── matchCondition ───────────────────────────────────────────────────────────

describe('matchCondition', () => {
  const message = {
    from: 'Ada Lovelace <ada@math.example.com>',
    subject: 'Invoice #42 due Friday',
    hasAttachments: true,
    triage: { category: 'receipt', urgency: 'high' },
  };

  test('sender contains / not_contains', () => {
    assert.equal(matchCondition({ field: 'sender', op: 'contains', value: 'ada' }, message), true);
    assert.equal(matchCondition({ field: 'sender', op: 'not_contains', value: 'bob' }, message), true);
  });

  test('domain equals', () => {
    assert.equal(
      matchCondition({ field: 'domain', op: 'equals', value: 'math.example.com' }, message),
      true,
    );
    assert.equal(matchCondition({ field: 'domain', op: 'equals', value: 'example.com' }, message), false);
  });

  test('subject contains is case-insensitive', () => {
    assert.equal(matchCondition({ field: 'subject', op: 'contains', value: 'INVOICE' }, message), true);
  });

  test('category / urgency equals', () => {
    assert.equal(matchCondition({ field: 'category', op: 'equals', value: 'receipt' }, message), true);
    assert.equal(matchCondition({ field: 'urgency', op: 'not_equals', value: 'low' }, message), true);
  });

  test('has_attachment boolean ops', () => {
    assert.equal(matchCondition({ field: 'has_attachment', op: 'is_true', value: '' }, message), true);
    assert.equal(matchCondition({ field: 'has_attachment', op: 'is_false', value: '' }, message), false);
  });

  test('empty condition list matches everything', () => {
    assert.equal(matchesConditions([], message), true);
  });

  test('conditions are AND-combined', () => {
    assert.equal(
      matchesConditions(
        [
          { field: 'domain', op: 'equals', value: 'math.example.com' },
          { field: 'urgency', op: 'equals', value: 'high' },
        ],
        message,
      ),
      true,
    );
    assert.equal(
      matchesConditions(
        [
          { field: 'domain', op: 'equals', value: 'math.example.com' },
          { field: 'urgency', op: 'equals', value: 'low' },
        ],
        message,
      ),
      false,
    );
  });
});

// ── triggerMatches ───────────────────────────────────────────────────────────

describe('triggerMatches', () => {
  const base = { enabled: true, accountId: ACCOUNT_ID, trigger: 'on_new_message', config: {} };

  test('on_high_urgency needs high triage', () => {
    const rule = { ...base, trigger: 'on_high_urgency' };
    assert.equal(triggerMatches(rule, { accountId: ACCOUNT_ID, triage: { urgency: 'high' } }), true);
    assert.equal(triggerMatches(rule, { accountId: ACCOUNT_ID, triage: { urgency: 'low' } }), false);
  });

  test('disabled rule never fires', () => {
    assert.equal(triggerMatches({ ...base, enabled: false }, { accountId: ACCOUNT_ID }), false);
  });
});

// ── dryRunAutomation ─────────────────────────────────────────────────────────

describe('dryRunAutomation', () => {
  test('counts messages the rule would match this week', async () => {
    insertMessage({ from_addr: 'a@acme.com', subject: 'Q1 report' });
    insertMessage({ from_addr: 'b@acme.com', subject: 'Q2 report' });
    insertMessage({ from_addr: 'c@other.com', subject: 'Spam' });
    // Old message outside the window should not count.
    insertMessage({ from_addr: 'd@acme.com', date_ms: Date.now() - 40 * 86_400_000 });

    const preview = await dryRunAutomation(
      ACCOUNT_ID,
      {
        accountId: ACCOUNT_ID,
        trigger: 'on_new_message',
        conditions: [{ field: 'domain', op: 'equals', value: 'acme.com' }],
        actions: [{ type: 'archive' }],
      },
      { days: 7 },
    );

    assert.equal(preview.total, 3);
    assert.equal(preview.matched, 2);
    assert.equal(preview.sample.length, 2);
  });
});

// ── audit log ────────────────────────────────────────────────────────────────

describe('audit log', () => {
  test('records and lists runs newest first', async () => {
    const db = getMailDb(ACCOUNT_ID);
    recordAutomationRun(db, { ruleId: 'ruleX', action: 'archive', outcome: 'queued' });
    recordAutomationRun(db, { ruleId: 'ruleX', action: 'os_notify', outcome: 'notified' });
    recordAutomationRun(db, { ruleId: 'ruleY', action: 'flag', outcome: 'applied' });

    const runs = await listAutomationRuns(ACCOUNT_ID, 'ruleX');
    assert.equal(runs.length, 2);
    assert.equal(runs[0].action, 'os_notify');
    assert.equal(runs[1].action, 'archive');
  });
});

// ── evaluateAutomationsForMessage ────────────────────────────────────────────

describe('evaluateAutomationsForMessage', () => {
  test('untrusted mail-op routes to the review queue and records queued', async () => {
    const rule = await createAutomation({
      name: 'Archive acme',
      accountId: ACCOUNT_ID,
      trigger: 'on_new_message',
      conditions: [{ field: 'domain', op: 'equals', value: 'acme.com' }],
      actions: [{ type: 'archive' }],
    });

    await evaluateAutomationsForMessage(ACCOUNT_ID, {
      id: 'm1',
      messageRowId: 1,
      folder: 'INBOX',
      from: 'sales@acme.com',
      subject: 'Deal',
    });

    const pending = await listPendingActions(ACCOUNT_ID);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].action, 'archive');
    assert.equal(pending[0].source, `automation:${rule.id}`);

    const runs = await listAutomationRuns(ACCOUNT_ID, rule.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].outcome, 'queued');
  });

  test('trusted mail-op skips the review queue (direct path)', async () => {
    const rule = await createAutomation({
      name: 'Trusted archive',
      accountId: ACCOUNT_ID,
      trigger: 'on_new_message',
      trusted: true,
      actions: [{ type: 'archive' }],
    });

    await evaluateAutomationsForMessage(ACCOUNT_ID, {
      id: 'm2',
      messageRowId: 2,
      folder: 'INBOX',
      from: 'x@y.com',
      subject: 'Anything',
    });

    // No IMAP in tests, so the direct apply fails — but crucially it never
    // enqueued a review item, proving the trusted path took the direct branch.
    const pending = await listPendingActions(ACCOUNT_ID);
    assert.equal(pending.length, 0);
    const runs = await listAutomationRuns(ACCOUNT_ID, rule.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].action, 'archive');
  });

  test('forward_to writes a draft and never sends', async () => {
    const rule = await createAutomation({
      name: 'Forward to boss',
      accountId: ACCOUNT_ID,
      trigger: 'on_new_message',
      actions: [{ type: 'forward_to', to: 'boss@example.com' }],
    });

    await evaluateAutomationsForMessage(ACCOUNT_ID, {
      id: 'm3',
      messageRowId: 3,
      folder: 'INBOX',
      from: 'client@example.com',
      subject: 'Proposal',
      bodyPreview: 'Please review.',
    });

    const db = getMailDb(ACCOUNT_ID);
    const drafts = db.prepare('SELECT * FROM drafts').all();
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].to_addr, 'boss@example.com');
    assert.match(drafts[0].subject, /^Fwd:/);

    const runs = await listAutomationRuns(ACCOUNT_ID, rule.id);
    assert.equal(runs[0].outcome, 'drafted');
  });

  test('os_notify reaches the scheduler notification queue', async () => {
    const rule = await createAutomation({
      name: 'Ping me',
      accountId: ACCOUNT_ID,
      trigger: 'on_new_message',
      actions: [{ type: 'os_notify', title: 'New mail', body: 'You got mail' }],
    });

    const before = (await listUnackedNotifications()).length;
    await evaluateAutomationsForMessage(ACCOUNT_ID, {
      id: 'm4',
      messageRowId: 4,
      folder: 'INBOX',
      from: 'a@b.com',
      subject: 'Hi',
    });

    const notifications = await listUnackedNotifications();
    assert.equal(notifications.length, before + 1);
    assert.ok(notifications.some((n) => n.jobId.startsWith(`email-automation:${rule.id}`)));

    const runs = await listAutomationRuns(ACCOUNT_ID, rule.id);
    assert.equal(runs[0].outcome, 'notified');
  });

  test('conditions gate the actions', async () => {
    const rule = await createAutomation({
      name: 'Only acme',
      accountId: ACCOUNT_ID,
      trigger: 'on_new_message',
      conditions: [{ field: 'domain', op: 'equals', value: 'acme.com' }],
      actions: [{ type: 'os_notify' }],
    });

    await evaluateAutomationsForMessage(ACCOUNT_ID, {
      id: 'm5',
      messageRowId: 5,
      folder: 'INBOX',
      from: 'nope@other.com',
      subject: 'Skip me',
    });

    const runs = await listAutomationRuns(ACCOUNT_ID, rule.id);
    assert.equal(runs.length, 0);
  });
});
