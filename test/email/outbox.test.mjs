/**
 * Outbox undo window and per-account send rate limiting.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';

const sendCalls = [];
/** Set by a test to make the next delivery fail at the SMTP layer. */
let smtpError = null;

mock.module('../../server/email/smtp.js', {
  namedExports: {
    sendEmail: async (input) => {
      sendCalls.push(input);
      if (smtpError) throw new Error(smtpError);
      return { ok: true, messageId: `<generated-${sendCalls.length}>`, accepted: [], rejected: [] };
    },
    draftReply: async () => ({}),
    resolveReplyVariantSend: async () => ({}),
  },
});

const {
  enqueueSend,
  cancelSend,
  listOutbox,
  resetOutboxForTests,
  setUndoWindowForTests,
  getUndoWindowMs,
} = await import('../../server/email/outbox.js');
const { resetSendRateLimitForTests } = await import('../../server/email/send-rate-limit.js');

/** Short enough to keep the suite fast, long enough to cancel within. */
const TEST_UNDO_WINDOW_MS = 60;

const draft = (overrides = {}) => ({
  accountId: 'acct-1',
  to: 'someone@example.com',
  subject: 'Hello',
  body: 'Body text',
  ...overrides,
});

/** Let the undo window elapse and the delivery promise settle. */
const waitForDelivery = async () => {
  await new Promise((resolve) => setTimeout(resolve, getUndoWindowMs() + 60));
};

describe('outbox', () => {
  beforeEach(() => {
    sendCalls.length = 0;
    smtpError = null;
    resetOutboxForTests();
    resetSendRateLimitForTests();
    setUndoWindowForTests(TEST_UNDO_WINDOW_MS);
  });

  afterEach(() => {
    resetOutboxForTests();
  });

  test('queues rather than sending immediately', () => {
    const entry = enqueueSend(draft());

    assert.equal(entry.status, 'queued');
    assert.equal(sendCalls.length, 0, 'nothing may go out during the undo window');
    assert.ok(new Date(entry.sendAt).getTime() > new Date(entry.queuedAt).getTime());
  });

  test('delivers once the undo window closes', async () => {
    enqueueSend(draft({ subject: 'Delivered' }));
    await waitForDelivery();

    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].subject, 'Delivered');
    assert.equal(listOutbox()[0].status, 'sent');
  });

  test('cancelling inside the window stops delivery for good', async () => {
    const entry = enqueueSend(draft());
    const cancelled = cancelSend(entry.id);

    assert.equal(cancelled.status, 'cancelled');
    await waitForDelivery();
    assert.equal(sendCalls.length, 0, 'a cancelled send must never reach SMTP');
  });

  test('cannot cancel after the window has closed', async () => {
    const entry = enqueueSend(draft());
    await waitForDelivery();

    assert.throws(() => cancelSend(entry.id), /already sent/);
    assert.equal(sendCalls.length, 1);
  });

  test('cancelling an unknown id is an error, not a silent no-op', () => {
    assert.throws(() => cancelSend('does-not-exist'), /not found/);
  });

  test('surfaces a failed send instead of losing it silently', async () => {
    smtpError = 'SMTP host refused the connection';
    enqueueSend(draft({ to: 'fails@example.com' }));
    await waitForDelivery();

    const [entry] = listOutbox();
    assert.equal(entry.status, 'failed');
    assert.match(entry.error, /refused the connection/);
  });

  test('requires the fields SMTP will need', () => {
    assert.throws(() => enqueueSend(draft({ accountId: '' })), /accountId is required/);
    assert.throws(() => enqueueSend(draft({ to: '' })), /to and subject are required/);
    assert.throws(() => enqueueSend(draft({ subject: '' })), /to and subject are required/);
  });
});

describe('send rate limit', () => {
  beforeEach(() => {
    sendCalls.length = 0;
    smtpError = null;
    resetOutboxForTests();
    resetSendRateLimitForTests();
    setUndoWindowForTests(TEST_UNDO_WINDOW_MS);
  });

  afterEach(() => {
    resetOutboxForTests();
  });

  test('refuses a flood from one account and reports 429', () => {
    for (let i = 0; i < 20; i += 1) {
      enqueueSend(draft({ subject: `msg ${i}` }));
    }

    assert.throws(
      () => enqueueSend(draft({ subject: 'over the line' })),
      (err) => {
        assert.match(err.message, /rate limit/i);
        assert.equal(err.status, 429, 'middleware maps this to HTTP 429');
        return true;
      },
    );
  });

  test('limits each account separately', () => {
    for (let i = 0; i < 20; i += 1) {
      enqueueSend(draft({ subject: `msg ${i}` }));
    }

    // A second account is unaffected by the first one's burst.
    assert.doesNotThrow(() => enqueueSend(draft({ accountId: 'acct-2' })));
  });

  test('a refused send is not queued', () => {
    for (let i = 0; i < 20; i += 1) {
      enqueueSend(draft());
    }
    assert.throws(() => enqueueSend(draft()));

    assert.equal(listOutbox().length, 20, 'the rejected send must leave no entry behind');
  });
});
