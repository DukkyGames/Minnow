/**
 * HMAC signing tests for outgoing webhooks.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildWebhookBody,
  buildWebhookHeaders,
  computeWebhookSignature,
} from '../../server/webhooks/sign.js';

const FIXED_SECRET = 'test-signing-secret-fixed-value';
const FIXED_TIMESTAMP = 1_700_000_000;
const FIXED_BODY = buildWebhookBody('chat.completed', {
  generationId: '11111111-1111-1111-1111-111111111111',
  status: 'completed',
});

describe('computeWebhookSignature', () => {
  test('produces stable sha256 digest for fixed secret and body', () => {
    const sig = computeWebhookSignature(FIXED_SECRET, FIXED_TIMESTAMP, FIXED_BODY);
    assert.match(sig, /^sha256=[0-9a-f]{64}$/);
    assert.equal(
      sig,
      computeWebhookSignature(FIXED_SECRET, FIXED_TIMESTAMP, FIXED_BODY),
    );
    assert.notEqual(
      sig,
      computeWebhookSignature('other-secret', FIXED_TIMESTAMP, FIXED_BODY),
    );
  });
});

describe('buildWebhookHeaders', () => {
  test('includes Minnow signing headers', () => {
    const headers = buildWebhookHeaders({
      event: 'webhook.test',
      deliveryId: '22222222-2222-2222-2222-222222222222',
      timestampSeconds: FIXED_TIMESTAMP,
      signature: 'sha256=abc',
    });
    assert.equal(headers['X-Minnow-Event'], 'webhook.test');
    assert.equal(headers['X-Minnow-Delivery'], '22222222-2222-2222-2222-222222222222');
    assert.equal(headers['X-Minnow-Timestamp'], String(FIXED_TIMESTAMP));
    assert.equal(headers['X-Minnow-Signature'], 'sha256=abc');
  });
});
