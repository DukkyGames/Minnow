/**
 * Email thread id normalization fixtures.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  computeThreadId,
  normalizeMessageId,
  normalizeSubject,
} from '../../server/email/threads.js';

describe('normalizeSubject', () => {
  test('strips repeated Re: prefixes', () => {
    assert.equal(normalizeSubject('Re: Re: Hello World'), 'hello world');
  });

  test('strips Fwd: prefix', () => {
    assert.equal(normalizeSubject('Fwd: Quarterly report'), 'quarterly report');
  });
});

describe('computeThreadId', () => {
  test('uses first References header when present', () => {
    const threadId = computeThreadId({
      messageId: '<child@example.com>',
      references: ['<root@example.com>', '<parent@example.com>'],
      subject: 'Re: Planning',
    });
    assert.equal(threadId, '<root@example.com>');
  });

  test('falls back to In-Reply-To', () => {
    const threadId = computeThreadId({
      messageId: '<child@example.com>',
      inReplyTo: '<parent@example.com>',
      subject: 'Re: Planning',
    });
    assert.equal(threadId, '<parent@example.com>');
  });

  test('uses normalized subject hash when no ids', () => {
    const a = computeThreadId({ subject: 'Hello Team' });
    const b = computeThreadId({ subject: 'Re: Hello Team' });
    assert.equal(a, b);
    assert.match(a, /^subject:/);
  });
});

describe('normalizeMessageId', () => {
  test('wraps bare ids in angle brackets', () => {
    assert.equal(normalizeMessageId('abc@example.com'), '<abc@example.com>');
  });
});
