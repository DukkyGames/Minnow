/**
 * Regression test for triage failure cooldown persistence (MIN-350 D1).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { recordTriageFailure } from '../../server/email/agent.js';
import {
  readMessageCache,
  writeMessageCache,
} from '../../server/email/cache.js';

const ACCOUNT_ID = 'acct-triage-failure-test';
const MESSAGE_KEY = 'INBOX:42';

let tempHome;
let savedHome;

before(async () => {
  savedHome = process.env.MINNOW_HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-email-triage-'));
  process.env.MINNOW_HOME = tempHome;

  const cacheDir = path.join(tempHome, 'email', 'cache', ACCOUNT_ID);
  await fs.mkdir(cacheDir, { recursive: true });
  await writeMessageCache(ACCOUNT_ID, {
    version: 1,
    folderCursors: {},
    messages: [
      {
        id: MESSAGE_KEY,
        uid: '42',
        folder: 'INBOX',
        threadId: '<thread@example.com>',
        from: 'Alice <alice@example.com>',
        to: ['me@example.com'],
        subject: 'Hello',
        date: '2026-06-28T12:00:00.000Z',
        bodyPreview: 'Hi',
      },
    ],
  });
});

after(async () => {
  if (savedHome === undefined) {
    delete process.env.MINNOW_HOME;
  } else {
    process.env.MINNOW_HOME = savedHome;
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});

describe('recordTriageFailure', () => {
  test('writes failedAt and failureReason to the message cache', async () => {
    await recordTriageFailure(ACCOUNT_ID, MESSAGE_KEY, 'invalid JSON from upstream');

    const cache = await readMessageCache(ACCOUNT_ID);
    const row = cache.messages.find((message) => message.id === MESSAGE_KEY);
    assert.ok(row);
    assert.ok(typeof row.triage?.failedAt === 'string');
    assert.match(row.triage.failedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(row.triage.failureReason, 'invalid JSON from upstream');
    assert.ok(typeof row.triage.cachedAt === 'string');
  });
});
