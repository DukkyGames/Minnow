/**
 * Reply header helper tests — target resolution and References chain.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildReferencesChain,
  buildReplySubject,
  collectAccountEmails,
  resolveReplyTarget,
} from '../../server/email/reply-headers.js';

const ACCOUNT = {
  username: 'me@example.com',
  fromAddress: 'Me <me@example.com>',
};

describe('resolveReplyTarget', () => {
  test('prefers Reply-To over From on the latest message', () => {
    const thread = [
      {
        from: 'Alice <alice@example.com>',
        replyTo: 'Support <support@example.com>',
      },
    ];
    assert.equal(
      resolveReplyTarget(thread, collectAccountEmails(ACCOUNT)),
      'support@example.com',
    );
  });

  test('skips own messages and replies to the prior correspondent', () => {
    const thread = [
      {
        from: 'Alice <alice@example.com>',
        replyTo: '',
      },
      {
        from: 'Me <me@example.com>',
        replyTo: '',
      },
    ];
    assert.equal(
      resolveReplyTarget(thread, collectAccountEmails(ACCOUNT)),
      'alice@example.com',
    );
  });

  test('falls back to latest From when every message is from self', () => {
    const thread = [
      {
        from: 'Me <me@example.com>',
        replyTo: '',
      },
    ];
    assert.equal(
      resolveReplyTarget(thread, collectAccountEmails(ACCOUNT)),
      'me@example.com',
    );
  });
});

describe('buildReferencesChain', () => {
  test('accumulates inReplyTo plus prior references', () => {
    const chain = buildReferencesChain({
      messageId: '<latest@example.com>',
      references: ['<root@example.com>', '<parent@example.com>'],
    });
    assert.equal(
      chain,
      '<latest@example.com> <root@example.com> <parent@example.com>',
    );
  });

  test('omits empty message ids', () => {
    assert.equal(buildReferencesChain({ messageId: '', references: [] }), '');
  });
});

describe('buildReplySubject', () => {
  test('prefixes Re: when missing', () => {
    assert.equal(buildReplySubject('Hello'), 'Re: Hello');
  });

  test('preserves existing Re: prefix', () => {
    assert.equal(buildReplySubject('Re: Hello'), 'Re: Hello');
  });
});
